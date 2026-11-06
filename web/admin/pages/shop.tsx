/** Shop: sell supplements & products at reception, manage the catalog and stock. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, Tabs, toast, toastError, useAction, useAsync, useDebounced } from "../../shared/ui.tsx";
import { fmtDate, fmtTime, money, t } from "../../shared/i18n.ts";
import { Link, can, useApp } from "../app.tsx";
import { openReceipt } from "../receipt.tsx";

const CATEGORIES = ["supplements", "drinks", "snacks", "accessories", "apparel", "other"] as const;
const CAT_LABEL: Record<string, string> = { supplements: "Supplements", drinks: "Drinks", snacks: "Snacks", accessories: "Accessories", apparel: "Apparel", other: "Other" };
const today = () => new Date().toISOString().slice(0, 10);

type Tab = "sell" | "products" | "sales" | "overview";

export function ShopPage() {
  const { me } = useApp();
  const manager = can(me, "owner", "manager");
  const [tab, setTab] = useState<Tab>("sell");
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Shop</h1><p>Supplements, drinks and accessories sold at reception.</p></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "sell", label: "Sell" },
        { value: "products", label: "Products & stock" },
        { value: "sales", label: "Sales" },
        ...(manager ? [{ value: "overview" as Tab, label: "Overview" }] : []),
      ]} />
      {tab === "sell" && <Pos />}
      {tab === "products" && <Products />}
      {tab === "sales" && <Sales />}
      {tab === "overview" && <Overview />}
    </div>
  );
}

// ---------------- point of sale ----------------

interface Line { p: any; qty: number }

function Pos() {
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
  const { busy, run } = useAction();
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
    if (p.track_stock && inCart(p.id) >= p.stock) { toast(`Only ${p.stock} × ${p.name} in stock`, "error"); return; }
    setCart((c) => (c.some((l) => l.p.id === p.id) ? c.map((l) => (l.p.id === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { p, qty: 1 }]));
  };
  const setQty = (id: string, qty: number) => setCart((c) => c.flatMap((l) => (l.p.id !== id ? [l] : qty <= 0 ? [] : [{ ...l, qty: l.p.track_stock ? Math.min(qty, l.p.stock) : qty }])));
  const reset = () => { setCart([]); setMember(null); setMemberQ(""); setDiscount(""); setReference(""); setOnAccount(false); setQ(""); products.reload(); search.current?.focus(); };

  const checkout = async () => {
    const r = await run(() => post("/api/shop/sales", {
      member_id: member?.id ?? null, items: cart.map((l) => ({ product_id: l.p.id, qty: l.qty })),
      discount_usd: Number(discount || 0), on_account: onAccount,
      payment: onAccount ? null : { currency, method, reference: reference || null },
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
          <input ref={search} className="input" style={{ flex: 1 }} value={q} placeholder="Search or scan a barcode" aria-label="Search or scan a barcode"
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
            <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c === "all" ? "All" : CAT_LABEL[c]}</button>
          ))}
        </div>
        <Loader state={products}>
          {() => list.length ? (
            <div className="tiles">
              {list.map((p: any) => {
                const out = p.track_stock && p.stock - inCart(p.id) <= 0;
                return (
                  <button key={p.id} className="tile" disabled={out} onClick={() => add(p)}>
                    <span className="tile-name">{p.name}</span>
                    <span className="tile-meta">{p.brand ?? CAT_LABEL[p.category]}</span>
                    <span className="tile-foot">
                      <b>{money(p.price, p.currency)}</b>
                      {p.track_stock && <span className={p.stock <= p.low_stock_at ? "money-neg" : "muted"}>{out ? "out of stock" : `${p.stock - inCart(p.id)} left`}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : <Empty title={(products.data ?? []).length ? "No product matches." : "No products yet."}>{!(products.data ?? []).length && "Add your supplements and drinks in Products & stock."}</Empty>}
        </Loader>
      </section>

      <aside className="pos-cart panel">
        <header><h2>Cart</h2>{cart.length > 0 && <button className="btn small ghost" onClick={reset}>Clear</button>}</header>
        <div className="body stack">
          {cart.length === 0 ? <p className="muted">Tap a product, or scan its barcode.</p> : (
            <div className="cart-lines">
              {cart.map((l) => (
                <div key={l.p.id} className="cart-line">
                  <span className="grow">{l.p.name}<small className="muted"> · {money(l.p.price, l.p.currency)}</small></span>
                  <span className="qty">
                    <button className="btn small" onClick={() => setQty(l.p.id, l.qty - 1)} aria-label="One less">−</button>
                    <b>{l.qty}</b>
                    <button className="btn small" onClick={() => setQty(l.p.id, l.qty + 1)} aria-label="One more">+</button>
                  </span>
                  <span className="line-total">{money(usd(l.p) * l.qty)}</span>
                </div>
              ))}
            </div>
          )}

          <Field label="Customer">
            {member ? (
              <div className="spread"><span className="who"><b>{member.first_name} {member.last_name}</b><small>#{member.code}{Number(member.balance_usd) > 0 ? ` · owes ${money(member.balance_usd)}` : ""}</small></span>
                <button className="btn small ghost" onClick={() => { setMember(null); setOnAccount(false); }}>Walk-in</button></div>
            ) : (
              <div className="stack-s">
                <input className="input" value={memberQ} onChange={(e) => setMemberQ(e.target.value)} placeholder="Walk-in, or search a member" />
                {found.data?.rows?.map((m: any) => <button key={m.id} className="btn ghost small" style={{ justifyContent: "flex-start" }} onClick={() => { setMember(m); setMemberQ(""); }}>{m.first_name} {m.last_name} <small className="muted">#{m.code}</small></button>)}
              </div>
            )}
          </Field>

          {cart.length > 0 && (
            <>
              <Field label="Discount ($)"><input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></Field>
              {member && <label className="check"><input type="checkbox" checked={onAccount} onChange={(e) => setOnAccount(e.target.checked)} /> Put on {member.first_name}'s account (pays later)</label>}
              {!onAccount && (
                <div className="grid-2">
                  <Field label={t("Currency")}><Segmented label={t("Currency")} value={currency} onChange={setCurrency} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
                  <Field label={t("Method")}>
                    <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{["cash", "whish", "omt", "card", "bank", "other"].map((m) => <option key={m} value={m}>{t(m)}</option>)}</select>
                  </Field>
                </div>
              )}
              {!onAccount && method !== "cash" && <Field label="Reference"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
              <div className="cart-total">
                <span>Total</span>
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
        <Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: "all", label: "All products" }, { value: "low", label: "Low stock" }]} />
        {manager && <button className="btn primary" onClick={() => setEdit({ category: "supplements", currency: "USD", track_stock: true, active: true, low_stock_at: 5, cost_usd: "", price: "", stock: "" })}><Icon name="plus" />New product</button>}
      </div>
      <Loader state={state}>
        {(list: any[]) => {
          const rows = filter === "low" ? list.filter((p) => p.active && p.track_stock && p.stock <= p.low_stock_at) : list;
          return rows.length ? (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Product</th><th>Category</th><th className="r">Price</th><th className="r">Cost</th><th className="r">Margin</th><th className="r">Stock</th><th className="r">Sold 30 days</th><th /></tr></thead>
              <tbody>{rows.map((p) => {
                const priceUsd = p.currency === "LBP" ? Number(p.price) / Number(me.gym.lbp_rate) : Number(p.price);
                const margin = priceUsd > 0 ? Math.round(((priceUsd - Number(p.cost_usd)) / priceUsd) * 100) : null;
                const low = p.track_stock && p.stock <= p.low_stock_at;
                return (
                  <tr key={p.id} style={!p.active ? { opacity: 0.45 } : undefined}>
                    <td><span className="who"><b>{p.name}</b><small>{[p.brand, p.barcode].filter(Boolean).join(" · ")}{p.expires_on ? <> · <span className={p.expires_on <= soon ? "money-neg" : ""}>expires {fmtDate(p.expires_on, { month: "short", year: "numeric" })}</span></> : null}</small></span></td>
                    <td>{CAT_LABEL[p.category]}</td>
                    <td className="r">{money(p.price, p.currency)}</td>
                    <td className="r muted">{Number(p.cost_usd) > 0 ? money(p.cost_usd) : "—"}</td>
                    <td className="r">{margin != null && Number(p.cost_usd) > 0 ? `${margin}%` : "—"}</td>
                    <td className="r">{p.track_stock ? <span className={low ? "money-neg" : ""}><span className="plate" data-s={p.stock <= 0 ? "denied" : low ? "warn" : "ok"} /> {p.stock}</span> : <span className="muted">not tracked</span>}</td>
                    <td className="r">{p.sold_30d}</td>
                    <td className="r">
                      {manager && p.track_stock && <button className="btn small" onClick={() => setStock({ p, kind: "restock", qty: "", unit_cost_usd: "", note: "", expires_on: "" })}>Restock</button>}{" "}
                      {manager && <button className="btn small ghost" onClick={() => setEdit({ ...p, stock: undefined })}>{t("Edit")}</button>}
                      {manager && p.track_stock && <button className="btn small ghost" onClick={async () => setMoves({ p, rows: await get(`/api/shop/products/${p.id}/moves`) })}>History</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <Empty title={filter === "low" ? "Nothing is running low." : "No products yet."} action={manager && filter === "all" ? <button className="btn primary" onClick={() => setEdit({ category: "supplements", currency: "USD", track_stock: true, active: true, low_stock_at: 5, cost_usd: "", price: "", stock: "" })}>Add your first product</button> : undefined} />;
        }}
      </Loader>
      {edit && <ProductModal p={edit} onClose={(saved) => { setEdit(null); if (saved) state.reload(); }} />}
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
          ) : <Empty title="No movement yet." />}
        </Modal>
      )}
    </div>
  );
}

function ProductModal({ p, onClose }: { p: any; onClose: (saved: boolean) => void }) {
  const [f, setF] = useState<any>(p);
  const { busy, run } = useAction();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    const body: any = {
      name: f.name, name_ar: f.name_ar || null, category: f.category, brand: f.brand || null, barcode: f.barcode || null,
      price: Number(f.price), currency: f.currency, cost_usd: Number(f.cost_usd || 0), low_stock_at: Number(f.low_stock_at || 0),
      track_stock: !!f.track_stock, expires_on: f.expires_on || null, active: !!f.active,
    };
    if (!f.id) body.stock = Number(f.stock || 0);
    const r = await run(() => (f.id ? put(`/api/shop/products/${f.id}`, body) : post("/api/shop/products", body)), t("Save"));
    if (r) onClose(true);
  };
  return (
    <Modal title={f.id ? f.name : "New product"} open onClose={() => onClose(false)} wide
      footer={<button className="btn primary" disabled={busy || !f.name || f.price === ""} onClick={save}>{t("Save")}</button>}>
      <div className="grid-2">
        <Field label="Name"><input className="input" value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Whey protein 2 kg — chocolate" autoFocus /></Field>
        <Field label="Name in Arabic"><input className="input" dir="rtl" value={f.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={(e) => set("category", e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select></Field>
        <Field label="Brand"><input className="input" value={f.brand ?? ""} onChange={(e) => set("brand", e.target.value)} /></Field>
        <Field label="Barcode" hint="Scan it with the USB scanner"><input className="input" value={f.barcode ?? ""} onChange={(e) => set("barcode", e.target.value)} /></Field>
        <Field label="Expiry date (current batch)"><input className="input" type="date" value={f.expires_on ?? ""} onChange={(e) => set("expires_on", e.target.value)} /></Field>
      </div>
      <div className="grid-3">
        <Field label="Selling price"><input className="input" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        <Field label={t("Currency")}><Segmented label={t("Currency")} value={f.currency} onChange={(v) => set("currency", v)} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
        <Field label="Purchase cost ($ per unit)" hint="Used to compute your margin"><input className="input" inputMode="decimal" value={f.cost_usd} onChange={(e) => set("cost_usd", e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        {!f.id && <Field label="Units in stock now"><input className="input" inputMode="numeric" value={f.stock} onChange={(e) => set("stock", e.target.value.replace(/\D/g, ""))} /></Field>}
        <Field label="Warn me below"><input className="input" inputMode="numeric" value={f.low_stock_at} onChange={(e) => set("low_stock_at", e.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={!!f.track_stock} onChange={(e) => set("track_stock", e.target.checked)} /> Track stock (untick for services, e.g. body composition scan)</label>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set("active", e.target.checked)} /> On sale</label>
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
      }}>{f.kind === "restock" ? `Add ${f.qty || 0} to stock` : "Save"}</button>}>
      <Segmented label="Type" value={f.kind} onChange={(k) => setF({ ...f, kind: k, sign: "-" })} options={[{ value: "restock", label: "Delivery received" }, { value: "adjust", label: "Correction" }]} />
      <p className="ink-2">In stock now: <b>{f.p.stock}</b></p>
      <div className="grid-2">
        {f.kind === "adjust" && <Field label="Direction"><Segmented label="Direction" value={f.sign ?? "-"} onChange={(v) => setF({ ...f, sign: v })} options={[{ value: "-", label: "Remove" }, { value: "+", label: "Add" }]} /></Field>}
        <Field label="Quantity"><input className="input" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, "") })} autoFocus /></Field>
        {f.kind === "restock" && <Field label="Cost per unit ($)" hint="Updates the average cost"><input className="input" inputMode="decimal" value={f.unit_cost_usd} onChange={(e) => setF({ ...f, unit_cost_usd: e.target.value.replace(/[^\d.]/g, "") })} /></Field>}
        {f.kind === "restock" && <Field label="Expiry date of this batch"><input className="input" type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></Field>}
      </div>
      <Field label="Note"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={f.kind === "restock" ? "Supplier, invoice number…" : "Expired, broken, inventory count…"} /></Field>
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
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" style={{ width: 160 }} />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" style={{ width: 160 }} />
      </div>
      <Loader state={state}>
        {(rows: any[]) => {
          const live = rows.filter((s) => s.status !== "void");
          return rows.length ? (
            <>
              <p className="ink-2">{live.length} sale(s) · <b>{money(live.reduce((s, x) => s + Number(x.total_usd), 0))}</b>{can(me, "owner", "manager") && <> · margin {money(live.reduce((s, x) => s + Number(x.total_usd) - Number(x.cost_usd), 0))}</>}</p>
              <div className="table-wrap"><table className="data">
                <thead><tr><th>#</th><th>Time</th><th>Customer</th><th>Items</th><th>Paid</th><th className="r">Total</th><th /></tr></thead>
                <tbody>{rows.map((s) => (
                  <tr key={s.id} style={s.status === "void" ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
                    <td>{s.sale_no}</td>
                    <td>{fmtDate(s.sold_at)} {fmtTime(s.sold_at)}</td>
                    <td>{s.member_id ? <Link to={`/members/${s.member_id}`}>{s.first_name} {s.last_name}</Link> : <span className="muted">Walk-in</span>}</td>
                    <td className="ink-2">{s.summary}</td>
                    <td>{s.status === "on_account" ? <span className="tag">on account</span> : t(s.method ?? "")}</td>
                    <td className="r"><b>{money(s.total_usd)}</b></td>
                    <td className="r">
                      {s.payment_id && <button className="btn small ghost" onClick={() => openReceipt(s.payment_id)} aria-label="Receipt"><Icon name="receipt" /></button>}
                      {s.status !== "void" && can(me, "owner", "manager") && <button className="btn small ghost danger" onClick={async () => {
                        const reason = prompt("Why are you voiding this sale? Products go back in stock.");
                        if (!reason) return;
                        await run(() => post(`/api/shop/sales/${s.id}/void`, { reason }), "Sale voided");
                        state.reload();
                      }}>Void</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          ) : <Empty title="No sale in this period." />;
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
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" style={{ width: 160 }} />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" style={{ width: 160 }} />
      </div>
      <Loader state={state}>
        {(d: any) => (
          <>
            <div className="figures">
              <div className="figure"><span className="label">Shop sales</span><span className="value num-display">{money(d.revenue)}</span><span className="delta">{d.sales} sales</span></div>
              <div className="figure"><span className="label">Margin</span><span className="value num-display">{money(d.margin)}</span><span className="delta">{d.margin_pct != null ? `${d.margin_pct}% of sales` : "set purchase costs to see it"}</span></div>
              <div className="figure"><span className="label">Stock value (at cost)</span><span className="value num-display">{money(d.stock_value)}</span></div>
              <div className="figure"><span className="label">To reorder</span><span className="value num-display">{d.low_stock}</span><span className="delta">{d.expiring_soon ? `${d.expiring_soon} product(s) expire within 30 days` : "no expiry in the next 30 days"}</span></div>
            </div>
            <div className="cols">
              <section className="panel">
                <header><h2>Best sellers</h2></header>
                {d.top.length ? (
                  <div className="table-wrap" style={{ border: 0 }}><table className="data">
                    <thead><tr><th>Product</th><th className="r">Units</th><th className="r">Sales</th><th className="r">Margin</th></tr></thead>
                    <tbody>{d.top.map((x: any) => <tr key={x.name}><td>{x.name}</td><td className="r">{x.qty}</td><td className="r">{money(x.revenue)}</td><td className="r">{money(x.margin)}</td></tr>)}</tbody>
                  </table></div>
                ) : <Empty title="No sales in this period." />}
              </section>
              <div className="stack">
                <section className="panel">
                  <header><h2>By category</h2></header>
                  <div className="list">{d.byCategory.map((c: any) => <div key={c.category}><span className="grow">{CAT_LABEL[c.category] ?? c.category}</span><b>{money(c.revenue)}</b></div>)}{!d.byCategory.length && <div className="muted">—</div>}</div>
                </section>
                <section className="panel">
                  <header><h2>Running low</h2></header>
                  <div className="list">{d.lowStock.map((p: any) => <div key={p.id}><span className="plate" data-s={p.stock <= 0 ? "denied" : "warn"} /><span className="grow">{p.name}</span><b>{p.stock}</b></div>)}{!d.lowStock.length && <div className="muted">Nothing to reorder.</div>}</div>
                </section>
              </div>
            </div>
          </>
        )}
      </Loader>
    </div>
  );
}
