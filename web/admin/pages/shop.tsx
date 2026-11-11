/** Shop: sell supplements & products at reception, manage the catalog and stock. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, Tabs, toast, toastError, useAction, useAsync, useDebounced } from "../../shared/ui.tsx";
import { fmtDate, fmtTime, money, t } from "../../shared/i18n.ts";
import { Link, can, useApp, usePath } from "../app.tsx";
import { shrinkImage } from "../../shared/image.ts";
import { openReceipt } from "../receipt.tsx";

const CATEGORIES = ["supplements", "drinks", "snacks", "accessories", "apparel", "other"] as const;
const CAT_LABEL: Record<string, string> = { supplements: "Supplements", drinks: "Drinks", snacks: "Snacks", accessories: "Accessories", apparel: "Apparel", other: "Other" };
const today = () => new Date().toISOString().slice(0, 10);

type Tab = "sell" | "orders" | "products" | "sales" | "overview";

/** What a product can still be sold as: bundles depend on the products inside them. */
const avail = (p: any) => (p.kind === "bundle" ? Number(p.bundle_stock ?? 99) : p.track_stock ? Number(p.stock) : Infinity);

export function ShopPage() {
  const { me } = useApp();
  const manager = can(me, "owner", "manager");
  const wanted = new URLSearchParams(usePath().split("?")[1] ?? "").get("tab");
  const [tab, setTab] = useState<Tab>((["sell", "orders", "products", "sales", "overview"] as const).find((x) => x === wanted) ?? "sell");
  const [pickup, setPickup] = useState<any>(null);
  const orders = useAsync(() => get("/api/shop/requests"), [tab]);
  const pending = (orders.data ?? []).filter((o: any) => o.status === "pending").length;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Shop")}</h1><p>{t("Supplements, drinks and accessories sold at reception.")}</p></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "sell", label: t("Sell") },
        { value: "orders", label: `${t("App orders")}${pending ? ` (${pending})` : ""}` },
        { value: "products", label: t("Products & stock") },
        { value: "sales", label: t("Sales") },
        ...(manager ? [{ value: "overview" as Tab, label: t("Overview") }] : []),
      ]} />
      {tab === "sell" && <Pos preset={pickup} onPresetUsed={() => setPickup(null)} />}
      {tab === "orders" && <Orders state={orders} onSell={(p) => { setPickup(p); setTab("sell"); }} />}
      {tab === "products" && <Products />}
      {tab === "sales" && <Sales />}
      {tab === "overview" && <Overview />}
    </div>
  );
}

// ---------------- point of sale ----------------

interface Line { p: any; qty: number }

function Pos({ preset, onPresetUsed }: { preset?: any; onPresetUsed?: () => void }) {
  const { me } = useApp();
  const rate = Number(me.gym?.lbp_rate ?? 89500);
  const products = useAsync(() => get("/api/shop/products"), []);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [cart, setCart] = useState<Line[]>([]);
  const [member, setMember] = useState<any>(null);
  const [memberQ, setMemberQ] = useState("");
  const dMemberQ = useDebounced(memberQ);
  const found = useAsync(() => (dMemberQ.length >= 2 ? get(`/api/members?q=${encodeURIComponent(dMemberQ)}&limit=5`) : Promise.resolve({ rows: [] })), [dMemberQ]);
  const [discount, setDiscount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [onAccount, setOnAccount] = useState(false);
  const [requestIds, setRequestIds] = useState<string[]>([]);
  const { busy, run } = useAction();
  // an app order being collected: its member and products go straight into the cart
  useEffect(() => {
    if (!preset || !products.data) return;
    const lines = preset.items.map((it: any) => ({ p: products.data.find((p: any) => p.id === it.product_id), qty: it.qty })).filter((l: any) => l.p);
    setCart(lines);
    setMember(preset.member);
    setRequestIds(preset.request_ids);
    onPresetUsed?.();
  }, [preset, products.data]);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus(); }, []);

  const list = (products.data ?? []).filter((p: any) =>
    (cat === "all" || p.category === cat) &&
    (!q || `${p.name} ${p.brand ?? ""} ${p.name_ar ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const usd = (p: any) => (p.currency === "LBP" ? Number(p.price) / rate : Number(p.price));
  const subtotal = cart.reduce((s, l) => s + usd(l.p) * l.qty, 0);
  const total = Math.max(0, Math.round((subtotal - Number(discount || 0)) * 100) / 100);
  const totalLbp = Math.max(1000, Math.round((total * rate) / 1000) * 1000);
  const inCart = (id: string) => cart.find((l) => l.p.id === id)?.qty ?? 0;

  const add = (p: any) => {
    if (inCart(p.id) >= avail(p)) { toast(`Only ${avail(p)} × ${p.name} in stock`, "error"); return; }
    setCart((c) => (c.some((l) => l.p.id === p.id) ? c.map((l) => (l.p.id === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { p, qty: 1 }]));
  };
  const setQty = (id: string, qty: number) => setCart((c) => c.flatMap((l) => (l.p.id !== id ? [l] : qty <= 0 ? [] : [{ ...l, qty: Math.min(qty, avail(l.p)) }])));
  const reset = () => { setCart([]); setMember(null); setMemberQ(""); setDiscount(""); setReference(""); setOnAccount(false); setQ(""); setRequestIds([]); products.reload(); search.current?.focus(); };

  const checkout = async () => {
    const r = await run(() => post("/api/shop/sales", {
      member_id: member?.id ?? null, items: cart.map((l) => ({ product_id: l.p.id, qty: l.qty })),
      discount_usd: Number(discount || 0), on_account: onAccount,
      payment: onAccount ? null : { currency, method, reference: reference || null },
      request_ids: requestIds.length ? requestIds : undefined,
    }));
    if (!r) return;
    if (r.payment) openReceipt(r.payment.id);
    else toast(`${money(r.sale.total_usd)} added to ${member.first_name}'s account`);
    reset();
  };

  return (
    <div className="pos">
      <section className="pos-catalog">
        <div className="row">
          <input ref={search} className="input" style={{ flex: 1 }} value={q} placeholder={t("Search or scan a barcode")} aria-label={t("Search or scan a barcode")}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !q.trim()) return;
              const exact = (products.data ?? []).find((p: any) => p.barcode && p.barcode === q.trim());
              const only = list.length === 1 ? list[0] : null;
              const hit = exact ?? only;
              if (hit) { add(hit); setQ(""); }
            }} />
        </div>
        <div className="chips-row">
          {["all", ...CATEGORIES].filter((c) => c === "all" || (products.data ?? []).some((p: any) => p.category === c)).map((c) => (
            <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c === "all" ? t("All") : CAT_LABEL[c]}</button>
          ))}
        </div>
        <Loader state={products}>
          {() => list.length ? (
            <div className="tiles">
              {list.map((p: any) => {
                const left = avail(p) - inCart(p.id);
                const out = left <= 0;
                return (
                  <button key={p.id} className="tile" disabled={out} onClick={() => add(p)}>
                    <span className="tile-name">{p.name}</span>
                    <span className="tile-meta">{p.kind === "bundle" ? t("Bundle") : p.brand ?? CAT_LABEL[p.category]}</span>
                    <span className="tile-foot">
                      <b>{money(p.price, p.currency)}</b>
                      {Number.isFinite(left) && <span className={left <= (p.low_stock_at ?? 3) ? "money-neg" : "muted"}>{out ? t("out of stock") : `${left} left`}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : <Empty title={(products.data ?? []).length ? t("No product matches.") : t("No products yet.")}>{!(products.data ?? []).length && t("Add your supplements and drinks in Products & stock.")}</Empty>}
        </Loader>
      </section>

      <aside className="pos-cart panel">
        <header><h2>{t("Cart")}</h2>{cart.length > 0 && <button className="btn small ghost" onClick={reset}>{t("Clear")}</button>}</header>
        {requestIds.length > 0 && <div className="pos-note"><Icon name="phone" width={16} height={16} /> {t("Order from the app: it will be marked collected.")}</div>}
        <div className="body stack">
          {cart.length === 0 ? <p className="muted">{t("Tap a product, or scan its barcode.")}</p> : (
            <div className="cart-lines">
              {cart.map((l) => (
                <div key={l.p.id} className="cart-line">
                  <span className="grow">{l.p.name}<small className="muted"> · {money(l.p.price, l.p.currency)}</small></span>
                  <span className="qty">
                    <button className="btn small" onClick={() => setQty(l.p.id, l.qty - 1)} aria-label={t("One less")}>−</button>
                    <b>{l.qty}</b>
                    <button className="btn small" onClick={() => setQty(l.p.id, l.qty + 1)} aria-label={t("One more")}>+</button>
                  </span>
                  <span className="line-total">{money(usd(l.p) * l.qty)}</span>
                </div>
              ))}
            </div>
          )}

          <Field label={t("Customer")}>
            {member ? (
              <div className="spread"><span className="who"><b>{member.first_name} {member.last_name}</b><small>#{member.code}{Number(member.balance_usd) > 0 ? ` · owes ${money(member.balance_usd)}` : ""}</small></span>
                <button className="btn small ghost" onClick={() => { setMember(null); setOnAccount(false); }}>{t("Walk-in")}</button></div>
            ) : (
              <div className="stack-s">
                <input className="input" value={memberQ} onChange={(e) => setMemberQ(e.target.value)} placeholder={t("Walk-in, or search a member")} />
                {found.data?.rows?.map((m: any) => <button key={m.id} className="btn ghost small" style={{ justifyContent: "flex-start" }} onClick={() => { setMember(m); setMemberQ(""); }}>{m.first_name} {m.last_name} <small className="muted">#{m.code}</small></button>)}
              </div>
            )}
          </Field>

          {cart.length > 0 && (
            <>
              <Field label={t("Discount ($)")}><input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></Field>
              {member && <label className="check"><input type="checkbox" checked={onAccount} onChange={(e) => setOnAccount(e.target.checked)} /> {t("Put on")}{" "}{member.first_name}{t("'s account (pays later)")}</label>}
              {!onAccount && (
                <div className="grid-2">
                  <Field label={t("Currency")}><Segmented label={t("Currency")} value={currency} onChange={setCurrency} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
                  <Field label={t("Method")}>
                    <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{["cash", "whish", "omt", "card", "bank", "other"].map((m) => <option key={m} value={m}>{t(m)}</option>)}</select>
                  </Field>
                </div>
              )}
              {!onAccount && method !== "cash" && <Field label={t("Reference")}><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
              <div className="cart-total">
                <span>{t("Total")}</span>
                <span><b className="num-display">{money(total)}</b>{!onAccount && currency === "LBP" && <small className="muted"> = {money(totalLbp, "LBP")}</small>}</span>
              </div>
              <button className="btn primary block" style={{ minHeight: 50 }} disabled={busy || !cart.length} onClick={checkout}>
                {onAccount ? `Add ${money(total)} to account` : `Charge ${currency === "LBP" ? money(totalLbp, "LBP") : money(total)}`}
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// ---------------- orders placed from the member app ----------------

function Orders({ state, onSell }: { state: any; onSell: (preset: any) => void }) {
  const { run } = useAction();
  const setStatus = async (id: string, status: string) => { if (await run(() => put(`/api/shop/requests/${id}`, { status }), status === "ready" ? "Member notified" : "Order cancelled")) state.reload(); };
  return (
    <Loader state={state}>
      {(list: any[]) => list.length ? (
        <div className="stack">
          <p className="ink-2" style={{ margin: 0 }}>{t("Members asked for these in the app. Prepare the order and mark it ready: the member gets a notification. When they come, sell it: it's marked collected.")}</p>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t("Asked")}</th><th>{t("Member")}</th><th>{t("Product")}</th><th className="r">{t("Price")}</th><th>{t("Status")}</th><th /></tr></thead>
            <tbody>{list.map((o) => (
              <tr key={o.id}>
                <td>{fmtDate(o.created_at, { weekday: "short", day: "numeric", month: "short" })} {fmtTime(o.created_at)}</td>
                <td><Link to={`/members/${o.member_id}`}>{o.first_name} {o.last_name}</Link> <small className="muted">#{o.code}</small></td>
                <td>{o.qty} × {o.product_name}{o.note && <><br /><small className="muted">“{o.note}”</small></>}{o.stock != null && o.stock < o.qty && <><br /><small className="money-neg">only {o.stock} {t("in stock")}</small></>}</td>
                <td className="r">{money(Number(o.price) * o.qty, o.currency)}</td>
                <td><span className="plate" data-s={o.status === "ready" ? "ok" : "warn"} /> {o.status === "ready" ? t("Ready") : t("To prepare")}</td>
                <td className="r">
                  {o.status === "pending" && <button className="btn small" onClick={() => setStatus(o.id, "ready")}><Icon name="check" />{t("Ready")}</button>}{" "}
                  <button className="btn small primary" onClick={() => onSell({ member: { id: o.member_id, first_name: o.first_name, last_name: o.last_name, code: o.code }, items: [{ product_id: o.product_id, qty: o.qty }], request_ids: [o.id] })}>{t("Sell")}</button>{" "}
                  <button className="btn small ghost" onClick={() => setStatus(o.id, "cancelled")}>{t("Cancel")}</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : <Empty title={t("No orders from the app.")}>{t("Members can tap “I want it” on a product in their app; it shows up here.")}</Empty>}
    </Loader>
  );
}

// ---------------- products & stock ----------------

function Products() {
  const { me } = useApp();
  const manager = can(me, "owner", "manager");
  const state = useAsync(() => get("/api/shop/products?all=1"), []);
  const [edit, setEdit] = useState<any>(null);
  const [stock, setStock] = useState<any>(null);
  const [moves, setMoves] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "low">("all");
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return (
    <div className="stack">
      <div className="spread">
        <Segmented label={t("Filter")} value={filter} onChange={setFilter} options={[{ value: "all", label: t("All products") }, { value: "low", label: t("Low stock") }]} />
        {manager && <div className="row">
          <button className="btn" onClick={() => setEdit({ kind: "bundle", category: "supplements", currency: "USD", track_stock: false, active: true, in_app: true, featured: true, low_stock_at: 0, cost_usd: "", price: "", stock: "", components: [] })}><Icon name="gift" />{t("New bundle")}</button>
          <button className="btn primary" onClick={() => setEdit({ kind: "item", category: "supplements", currency: "USD", track_stock: true, active: true, in_app: true, featured: false, low_stock_at: 5, cost_usd: "", price: "", stock: "", components: [] })}><Icon name="plus" />{t("New product")}</button>
        </div>}
      </div>
      <Loader state={state}>
        {(list: any[]) => {
          const rows = filter === "low" ? list.filter((p) => p.active && p.track_stock && p.stock <= p.low_stock_at) : list;
          return rows.length ? (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>{t("Product")}</th><th>{t("Category")}</th><th className="r">{t("Price")}</th><th className="r">{t("Cost")}</th><th className="r">{t("Margin")}</th><th className="r">{t("Stock")}</th><th className="r">{t("Sold 30 days")}</th><th /></tr></thead>
              <tbody>{rows.map((p) => {
                const priceUsd = p.currency === "LBP" ? Number(p.price) / Number(me.gym.lbp_rate) : Number(p.price);
                const margin = priceUsd > 0 ? Math.round(((priceUsd - Number(p.cost_usd)) / priceUsd) * 100) : null;
                const low = p.track_stock && p.stock <= p.low_stock_at;
                return (
                  <tr key={p.id} style={!p.active ? { opacity: 0.45 } : undefined}>
                    <td><span className="who prod-cell">{p.has_image ? <img src={`/api/public/products/${p.id}/image`} alt="" className="prod-thumb" /> : <span className="prod-thumb empty"><Icon name={p.kind === "bundle" ? "gift" : "bag"} width={16} height={16} /></span>}<span><b>{p.name}</b>{p.kind === "bundle" && <span className="tag" style={{ marginInlineStart: 6 }}>bundle</span>}{p.featured && <span className="tag" style={{ marginInlineStart: 6 }}>{t("on app home")}</span>}{!p.in_app && <span className="tag muted" style={{ marginInlineStart: 6 }}>{t("hidden in app")}</span>}<br /><small>{p.kind === "bundle" ? p.contents : [p.brand, p.barcode].filter(Boolean).join(" · ")}{p.expires_on ? <> · <span className={p.expires_on <= soon ? "money-neg" : ""}>expires {fmtDate(p.expires_on, { month: "short", year: "numeric" })}</span></> : null}</small></span></span></td>
                    <td>{CAT_LABEL[p.category]}</td>
                    <td className="r">{money(p.price, p.currency)}</td>
                    <td className="r muted">{p.kind !== "bundle" && Number(p.cost_usd) > 0 ? money(p.cost_usd) : "—"}</td>
                    <td className="r">{p.kind !== "bundle" && margin != null && Number(p.cost_usd) > 0 ? `${margin}%` : "—"}</td>
                    <td className="r">{p.kind === "bundle" ? <span className="muted" title={t("Limited by the products inside")}>{p.bundle_stock ?? "—"} possible</span> : p.track_stock ? <span className={low ? "money-neg" : ""}><span className="plate" data-s={p.stock <= 0 ? "denied" : low ? "warn" : "ok"} /> {p.stock}</span> : <span className="muted">{t("not tracked")}</span>}</td>
                    <td className="r">{p.sold_30d}</td>
                    <td className="r">
                      {manager && p.track_stock && <button className="btn small" onClick={() => setStock({ p, kind: "restock", qty: "", unit_cost_usd: "", note: "", expires_on: "" })}>{t("Restock")}</button>}{" "}
                      {manager && <button className="btn small ghost" onClick={() => setEdit({ ...p, stock: undefined, description: p.description ?? "", components: p.components ?? [] })}>{t("Edit")}</button>}
                      {manager && p.track_stock && <button className="btn small ghost" onClick={async () => setMoves({ p, rows: await get(`/api/shop/products/${p.id}/moves`) })}>{t("History")}</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <Empty title={filter === "low" ? t("Nothing is running low.") : t("No products yet.")} action={manager && filter === "all" ? <button className="btn primary" onClick={() => setEdit({ category: "supplements", currency: "USD", track_stock: true, active: true, low_stock_at: 5, cost_usd: "", price: "", stock: "" })}>{t("Add your first product")}</button> : undefined} />;
        }}
      </Loader>
      {edit && <ProductModal p={edit} all={state.data ?? []} onClose={(saved) => { setEdit(null); if (saved) state.reload(); }} />}
      {stock && <StockModal s={stock} onClose={(saved) => { setStock(null); if (saved) state.reload(); }} />}
      {moves && (
        <Modal title={`Stock history · ${moves.p.name}`} open onClose={() => setMoves(null)} wide>
          {moves.rows.length ? (
            <div className="table-wrap"><table className="data"><tbody>{moves.rows.map((m: any) => (
              <tr key={m.id}><td>{fmtDate(m.at, { day: "numeric", month: "short" })} {fmtTime(m.at)}</td>
                <td style={{ textTransform: "capitalize" }}>{m.kind}{m.sale_no ? ` #${m.sale_no}` : ""}</td>
                <td className="r" style={{ color: m.qty > 0 ? "var(--plate-green)" : undefined }}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                <td className="muted">{m.note ?? ""}{m.unit_cost_usd ? ` · ${money(m.unit_cost_usd)}/unit` : ""}</td><td className="muted">{m.by_name ?? ""}</td></tr>
            ))}</tbody></table></div>
          ) : <Empty title={t("No movement yet.")} />}
        </Modal>
      )}
    </div>
  );
}

function ProductModal({ p, all, onClose }: { p: any; all: any[]; onClose: (saved: boolean) => void }) {
  const [f, setF] = useState<any>(p);
  const [image, setImage] = useState<string | null | undefined>(undefined);
  const bundle = f.kind === "bundle";
  const items = all.filter((x) => x.kind !== "bundle" && x.active && x.id !== f.id);
  const comps: { product_id: string; qty: number }[] = f.components ?? [];
  const compValue = comps.reduce((s, c) => { const x = items.find((i) => i.id === c.product_id); return s + (x ? Number(x.price) * c.qty : 0); }, 0);
  const { busy, run } = useAction();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    const body: any = {
      name: f.name, name_ar: f.name_ar || null, category: f.category, brand: f.brand || null, barcode: f.barcode || null,
      price: Number(f.price), currency: f.currency, cost_usd: Number(f.cost_usd || 0), low_stock_at: Number(f.low_stock_at || 0),
      track_stock: bundle ? false : !!f.track_stock, expires_on: f.expires_on || null, active: !!f.active,
      description: f.description || null, in_app: !!f.in_app, featured: !!f.featured, kind: f.kind ?? "item",
      components: bundle ? comps.filter((c) => c.product_id && c.qty > 0) : [],
    };
    if (!f.id && !bundle) body.stock = Number(f.stock || 0);
    const r = await run(() => (f.id ? put(`/api/shop/products/${f.id}`, body) : post("/api/shop/products", body)), t("Save"));
    if (!r) return;
    if (image !== undefined) { try { await put(`/api/shop/products/${f.id ?? r.id}/image`, { image }); } catch (e) { toastError(e); } }
    onClose(true);
  };
  return (
    <Modal title={f.id ? f.name : bundle ? t("New bundle") : t("New product")} open onClose={() => onClose(false)} wide
      footer={<button className="btn primary" disabled={busy || !f.name || f.price === "" || (bundle && !comps.some((c) => c.product_id))} onClick={save}>{t("Save")}</button>}>
      {bundle && (
        <section className="bundle-box">
          <b>{t("Inside the bundle")}</b>
          <small className="muted">{t("Selling the bundle takes these products out of stock.")}{" "}{compValue > 0 && <>{t("Bought separately:")}{" "}<b>{money(compValue)}</b>{Number(f.price) > 0 && Number(f.price) < compValue ? <> {t("· members save")}{" "}<b>{money(compValue - Number(f.price))}</b></> : null}</>}</small>
          {comps.map((c, i) => (
            <div key={i} className="row">
              <select className="input" style={{ flex: 1 }} value={c.product_id} onChange={(e) => set("components", comps.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))}>
                <option value="">{t("Choose a product…")}</option>
                {items.map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.price, x.currency)}</option>)}
              </select>
              <input className="input" style={{ width: 70 }} inputMode="numeric" value={c.qty} onChange={(e) => set("components", comps.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value.replace(/\D/g, "") || 0) } : x)))} aria-label={t("Quantity")} />
              <button className="btn small ghost" onClick={() => set("components", comps.filter((_, j) => j !== i))} aria-label={t("Remove")}><Icon name="x" /></button>
            </div>
          ))}
          <button className="btn small" onClick={() => set("components", [...comps, { product_id: "", qty: 1 }])}><Icon name="plus" />{t("Add a product")}</button>
        </section>
      )}
      <div className="grid-2">
        <Field label={t("Name")}><input className="input" value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder={t("Whey protein 2 kg — chocolate")} autoFocus /></Field>
        <Field label={t("Name in Arabic")}><input className="input" dir="rtl" value={f.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} /></Field>
        <Field label={t("Category")}><select className="input" value={f.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select></Field>
        <Field label={t("Brand")}><input className="input" value={f.brand ?? ""} onChange={(e) => set("brand", e.target.value)} /></Field>
        {!bundle && <Field label={t("Barcode")} hint={t("Scan it with the USB scanner")}><input className="input" value={f.barcode ?? ""} onChange={(e) => set("barcode", e.target.value)} /></Field>}
        {!bundle && <Field label={t("Expiry date (current batch)")}><input className="input" type="date" value={f.expires_on ?? ""} onChange={(e) => set("expires_on", e.target.value)} /></Field>}
      </div>
      <Field label={t("Description for members")} hint={t("Shown in the app: what it is, how to use it, flavours…")}><textarea className="input" rows={2} maxLength={1000} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} dir="auto" /></Field>
      <Field label={t("Photo")} hint={t("Shown in the member app; resized automatically")}>
        <div className="row">
          {(image || (image === undefined && f.has_image)) && <img className="thumb" src={image ?? `/api/public/products/${f.id}/image`} alt="" />}
          <input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setImage(await shrinkImage(file)); } catch (err) { toastError(err); } }} />
          {(image || (image === undefined && f.has_image)) && <button className="btn small ghost" onClick={() => setImage(null)}>{t("Remove")}</button>}
        </div>
      </Field>
      <div className="grid-3">
        <Field label={t("Selling price")}><input className="input" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        <Field label={t("Currency")}><Segmented label={t("Currency")} value={f.currency} onChange={(v) => set("currency", v)} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
        {!bundle && <Field label={t("Purchase cost ($ per unit)")} hint={t("Used to compute your margin")}><input className="input" inputMode="decimal" value={f.cost_usd} onChange={(e) => set("cost_usd", e.target.value.replace(/[^\d.]/g, ""))} /></Field>}
        {!f.id && !bundle && <Field label={t("Units in stock now")}><input className="input" inputMode="numeric" value={f.stock} onChange={(e) => set("stock", e.target.value.replace(/\D/g, ""))} /></Field>}
        {!bundle && <Field label={t("Warn me below")}><input className="input" inputMode="numeric" value={f.low_stock_at} onChange={(e) => set("low_stock_at", e.target.value.replace(/\D/g, ""))} /></Field>}
      </div>
      {!bundle && <label className="check"><input type="checkbox" checked={!!f.track_stock} onChange={(e) => set("track_stock", e.target.checked)} /> {t("Track stock (untick for services, e.g. body composition scan)")}</label>}
      <label className="check"><input type="checkbox" checked={!!f.in_app} onChange={(e) => set("in_app", e.target.checked)} /> {t("Show in the member app catalogue")}</label>
      <label className="check"><input type="checkbox" checked={!!f.featured} onChange={(e) => set("featured", e.target.checked)} /> {t("Feature it on the app's home screen")}</label>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set("active", e.target.checked)} /> {t("On sale")}</label>
    </Modal>
  );
}

function StockModal({ s, onClose }: { s: any; onClose: (saved: boolean) => void }) {
  const [f, setF] = useState<any>(s);
  const { busy, run } = useAction();
  const qty = Number(f.qty || 0) * (f.kind === "adjust" && f.sign === "-" ? -1 : 1);
  return (
    <Modal title={`${f.kind === "restock" ? "Restock" : "Adjust stock"} · ${f.p.name}`} open onClose={() => onClose(false)}
      footer={<button className="btn primary" disabled={busy || !qty} onClick={async () => {
        const r = await run(() => post(`/api/shop/products/${f.p.id}/stock`, { kind: f.kind, qty, unit_cost_usd: f.unit_cost_usd === "" ? null : Number(f.unit_cost_usd), expires_on: f.expires_on || null, note: f.note || null }), "Stock updated");
        if (r) onClose(true);
      }}>{f.kind === "restock" ? `Add ${f.qty || 0} to stock` : t("Save")}</button>}>
      <Segmented label={t("Type")} value={f.kind} onChange={(k) => setF({ ...f, kind: k, sign: "-" })} options={[{ value: "restock", label: t("Delivery received") }, { value: "adjust", label: t("Correction") }]} />
      <p className="ink-2">{t("In stock now:")}{" "}<b>{f.p.stock}</b></p>
      <div className="grid-2">
        {f.kind === "adjust" && <Field label={t("Direction")}><Segmented label={t("Direction")} value={f.sign ?? "-"} onChange={(v) => setF({ ...f, sign: v })} options={[{ value: "-", label: t("Remove") }, { value: "+", label: t("Add") }]} /></Field>}
        <Field label={t("Quantity")}><input className="input" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, "") })} autoFocus /></Field>
        {f.kind === "restock" && <Field label={t("Cost per unit ($)")} hint={t("Updates the average cost")}><input className="input" inputMode="decimal" value={f.unit_cost_usd} onChange={(e) => setF({ ...f, unit_cost_usd: e.target.value.replace(/[^\d.]/g, "") })} /></Field>}
        {f.kind === "restock" && <Field label={t("Expiry date of this batch")}><input className="input" type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></Field>}
      </div>
      <Field label={t("Note")}><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={f.kind === "restock" ? t("Supplier, invoice number…") : t("Expired, broken, inventory count…")} /></Field>
    </Modal>
  );
}

// ---------------- sales ----------------

function Sales() {
  const { me } = useApp();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const state = useAsync(() => get(`/api/shop/sales?from=${from}&to=${to}`), [from, to]);
  const { run } = useAction();
  return (
    <div className="stack">
      <div className="row">
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("From")} style={{ width: 160 }} />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("To")} style={{ width: 160 }} />
      </div>
      <Loader state={state}>
        {(rows: any[]) => {
          const live = rows.filter((s) => s.status !== "void");
          return rows.length ? (
            <>
              <p className="ink-2">{live.length} {t("sale(s) ·")}{" "}<b>{money(live.reduce((s, x) => s + Number(x.total_usd), 0))}</b>{can(me, "owner", "manager") && <> {t("· margin")}{" "}{money(live.reduce((s, x) => s + Number(x.total_usd) - Number(x.cost_usd), 0))}</>}</p>
              <div className="table-wrap"><table className="data">
                <thead><tr><th>#</th><th>{t("Time")}</th><th>{t("Customer")}</th><th>{t("Items")}</th><th>{t("Paid")}</th><th className="r">{t("Total")}</th><th /></tr></thead>
                <tbody>{rows.map((s) => (
                  <tr key={s.id} style={s.status === "void" ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
                    <td>{s.sale_no}</td>
                    <td>{fmtDate(s.sold_at)} {fmtTime(s.sold_at)}</td>
                    <td>{s.member_id ? <Link to={`/members/${s.member_id}`}>{s.first_name} {s.last_name}</Link> : <span className="muted">{t("Walk-in")}</span>}</td>
                    <td className="ink-2">{s.summary}</td>
                    <td>{s.status === "on_account" ? <span className="tag">{t("on account")}</span> : t(s.method ?? "")}</td>
                    <td className="r"><b>{money(s.total_usd)}</b></td>
                    <td className="r">
                      {s.payment_id && <button className="btn small ghost" onClick={() => openReceipt(s.payment_id)} aria-label={t("Receipt")}><Icon name="receipt" /></button>}
                      {s.status !== "void" && can(me, "owner", "manager") && <button className="btn small ghost danger" onClick={async () => {
                        const reason = prompt("Why are you voiding this sale? Products go back in stock.");
                        if (!reason) return;
                        await run(() => post(`/api/shop/sales/${s.id}/void`, { reason }), "Sale voided");
                        state.reload();
                      }}>{t("Void")}</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          ) : <Empty title={t("No sale in this period.")} />;
        }}
      </Loader>
    </div>
  );
}

// ---------------- overview ----------------

function Overview() {
  const monthStart = today().slice(0, 8) + "01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today());
  const state = useAsync(() => get(`/api/shop/summary?from=${from}&to=${to}`), [from, to]);
  return (
    <div className="stack">
      <div className="row">
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("From")} style={{ width: 160 }} />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("To")} style={{ width: 160 }} />
      </div>
      <Loader state={state}>
        {(d: any) => (
          <>
            <div className="figures">
              <div className="figure"><span className="label">{t("Shop sales")}</span><span className="value num-display">{money(d.revenue)}</span><span className="delta">{d.sales} sales</span></div>
              <div className="figure"><span className="label">{t("Margin")}</span><span className="value num-display">{money(d.margin)}</span><span className="delta">{d.margin_pct != null ? `${d.margin_pct}% of sales` : t("set purchase costs to see it")}</span></div>
              <div className="figure"><span className="label">{t("Stock value (at cost)")}</span><span className="value num-display">{money(d.stock_value)}</span></div>
              <div className="figure"><span className="label">{t("To reorder")}</span><span className="value num-display">{d.low_stock}</span><span className="delta">{d.expiring_soon ? `${d.expiring_soon} product(s) expire within 30 days` : t("no expiry in the next 30 days")}</span></div>
            </div>
            <div className="cols">
              <section className="panel">
                <header><h2>{t("Best sellers")}</h2></header>
                {d.top.length ? (
                  <div className="table-wrap" style={{ border: 0 }}><table className="data">
                    <thead><tr><th>{t("Product")}</th><th className="r">{t("Units")}</th><th className="r">{t("Sales")}</th><th className="r">{t("Margin")}</th></tr></thead>
                    <tbody>{d.top.map((x: any) => <tr key={x.name}><td>{x.name}</td><td className="r">{x.qty}</td><td className="r">{money(x.revenue)}</td><td className="r">{money(x.margin)}</td></tr>)}</tbody>
                  </table></div>
                ) : <Empty title={t("No sales in this period.")} />}
              </section>
              <div className="stack">
                <section className="panel">
                  <header><h2>{t("By category")}</h2></header>
                  <div className="list">{d.byCategory.map((c: any) => <div key={c.category}><span className="grow">{CAT_LABEL[c.category] ?? c.category}</span><b>{money(c.revenue)}</b></div>)}{!d.byCategory.length && <div className="muted">—</div>}</div>
                </section>
                <section className="panel">
                  <header><h2>{t("Running low")}</h2></header>
                  <div className="list">{d.lowStock.map((p: any) => <div key={p.id}><span className="plate" data-s={p.stock <= 0 ? "denied" : "warn"} /><span className="grow">{p.name}</span><b>{p.stock}</b></div>)}{!d.lowStock.length && <div className="muted">{t("Nothing to reorder.")}</div>}</div>
                </section>
              </div>
            </div>
          </>
        )}
      </Loader>
    </div>
  );
}
