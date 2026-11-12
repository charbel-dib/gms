/**
 * Home: everything a member checks in a few seconds.
 * Pass (one tap to show the QR), what's next, this week's goal and streak,
 * the gym's challenge, offers and featured products.
 */
import React, { useEffect, useState } from "react";
import { get, post } from "../shared/api.ts";
import { Icon, Spinner, toast, toastError, useAsync } from "../shared/ui.tsx";
import { fmtDate, getLang, money, t } from "../shared/i18n.ts";
import { qrSvg } from "../shared/qr.ts";
import { Bar, Ring, Section, Sheet, Thumb, View, greeting, minutes, when } from "./ui.tsx";
import { currentSubscription, enablePush, pushSupport } from "./push.ts";
import { InstallCard } from "./install.tsx";

export function PassSheet({ me, open, onClose }: { me: any; open: boolean; onClose: () => void }) {
  const m = me.member;
  // keep the screen awake while the QR is shown, where supported
  useEffect(() => {
    if (!open) return;
    let lock: any;
    (navigator as any).wakeLock?.request("screen").then((l: any) => (lock = l)).catch(() => {});
    return () => { lock?.release?.(); };
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={t("Your pass")}>
      <section className="pass" data-s={m.status} aria-label={t("Your pass")}>
        <div className="who-line"><b>{m.first_name} {m.last_name}</b><span className="code">#{m.code}</span></div>
        <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg(`GMS:${m.qr_token}`) }} />
        <span className="m-muted" style={{ fontSize: "0.9rem" }}>{t("Show this at reception")}</span>
        <PassStatus m={m} />
      </section>
    </Sheet>
  );
}

function PassStatus({ m }: { m: any }) {
  return (
    <div className="pass-status">
      <span className="plate" data-s={m.status === "none" ? "expired" : m.status} />
      <div className="grow">
        <b>{t(m.status)}</b>
        <small>{m.plan_name ?? "—"}{m.end_date ? ` · ${t("Valid until")} ${fmtDate(m.end_date, { day: "numeric", month: "long" })}` : ""}</small>
      </div>
      {m.days_left != null && m.days_left >= 0 && <div style={{ textAlign: "end" }}><div className="days-big">{m.visits_total != null ? m.visits_total - m.visits_used : m.days_left}</div><small className="m-muted">{m.visits_total != null ? t("visits left") : t("days left")}</small></div>}
    </div>
  );
}

export function OfferSheet({ offer, onClose, onWant }: { offer: any; onClose: () => void; onWant: (productId: string) => void }) {
  return (
    <Sheet open={!!offer} onClose={onClose} title={offer?.kind === "event" ? t("Event") : t("Offer")}
      footer={offer?.product_id ? <button className="m-btn block" onClick={() => onWant(offer.product_id)}>{t("See the product")}</button>
        : offer?.plan_id ? <p className="m-muted" style={{ margin: 0 }}>{t("Ask at reception to get it.")}</p> : null}>
      {offer && (
        <div className="m-detail">
          {offer.has_image && <img className="m-hero-img" src={`/api/public/offers/${offer.id}/image`} alt="" />}
          {offer.badge && <span className="m-badge big">{offer.badge}</span>}
          <h3 dir="auto">{offer.title}</h3>
          {offer.body && <p dir="auto">{offer.body}</p>}
          {offer.plan_name && <p className="m-muted">{t("Plan")}: <b>{offer.plan_name}</b> · {money(offer.plan_price, offer.plan_currency)}</p>}
          {offer.ends_on && <p className="m-muted">{t("Until")} {fmtDate(offer.ends_on, { day: "numeric", month: "long" })}</p>}
        </div>
      )}
    </Sheet>
  );
}

function NotifyCard() {
  const [state, setState] = useState<"hidden" | "offer" | "ios">("hidden");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem("gms.push.dismissed") === "1") return; } catch { /* ignore */ }
    const s = pushSupport();
    if (s === "ios_install") return setState("ios");
    if (s !== "ok" || Notification.permission === "denied") return;
    currentSubscription().then((sub) => setState(sub && Notification.permission === "granted" ? "hidden" : "offer"), () => setState("offer"));
  }, []);
  if (state === "hidden") return null;
  const dismiss = () => { try { localStorage.setItem("gms.push.dismissed", "1"); } catch { /* ignore */ } setState("hidden"); };
  return (
    <div className="install">
      <Icon name="bell" width={22} height={22} />
      <div style={{ flex: 1 }}>
        <b>{t("Turn on notifications")}</b>
        <div className="m-muted" style={{ fontSize: "0.85rem" }}>{state === "ios" ? t("On iPhone: add the app to your home screen first (Share → Add to Home Screen), then open it from there.") : t("Class reminders, your membership and gym news.")}</div>
      </div>
      {state === "offer" && <button className="m-btn" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const r = await enablePush(); if (r === "on") { toast(t("Notifications are on")); setState("hidden"); } else if (r === "denied") dismiss(); } catch (e) { toastError(e); } finally { setBusy(false); }
      }}>{t("Turn on")}</button>}
      <button className="m-icon" onClick={dismiss} aria-label={t("Close")}><Icon name="x" width={16} height={16} /></button>
    </div>
  );
}

export function HomeView({ me, go, openProduct }: { me: any; go: (v: View) => void; openProduct: (id: string) => void }) {
  const state = useAsync(() => get("/api/m/home"), []);
  const [pass, setPass] = useState(false);
  const [offer, setOffer] = useState<any>(null);
  const m = me.member;
  const d = state.data;
  return (
    <div className="m-body">
      <div className="m-hello-row">
        <h1 className="m-hello">{greeting()}{getLang() === "ar" ? "، " : ", "}{m.first_name}</h1>
      </div>

      <button className="pass-mini" data-s={m.status} onClick={() => setPass(true)} aria-label={t("Show my pass")}>
        <span className="qr-mini" dangerouslySetInnerHTML={{ __html: qrSvg(`GMS:${m.qr_token}`) }} />
        <span className="grow">
          <b>{t(m.status)}</b>
          <small>{m.plan_name ?? t("No membership")}{m.end_date ? ` · ${t("until")} ${fmtDate(m.end_date, { day: "numeric", month: "short" })}` : ""}</small>
          <span className="pass-mini-cta">{t("Tap to show your pass")}</span>
        </span>
        {m.days_left != null && m.days_left >= 0 && <span className="pass-mini-days"><b className="num-display">{m.visits_total != null ? m.visits_total - m.visits_used : m.days_left}</b><small>{m.visits_total != null ? t("visits left") : t("days left")}</small></span>}
      </button>
      {Number(m.balance_usd) > 0 && <p className="m-error" style={{ margin: 0 }}>{t("Balance to settle at reception")}: {money(m.balance_usd)}</p>}

      {!d ? <Spinner /> : (
        <>
          {d.requests.some((r: any) => r.status === "ready") && (
            <button className="m-banner ok" onClick={() => go("shop")}><Icon name="bag" width={20} height={20} /><span className="grow">{t("Your order is ready at reception")}: {d.requests.filter((r: any) => r.status === "ready").map((r: any) => r.name).join(", ")}</span><Icon name="chevron" width={16} height={16} /></button>
          )}

          {(d.next.class || d.next.pt) && (
            <Section title={t("Next up")}>
              <div className="m-list">
                {d.next.class && (
                  <button className="m-next" onClick={() => go("classes")}>
                    <span className="bar" style={{ background: d.next.class.color }} />
                    <span className="grow"><b>{getLang() === "ar" && d.next.class.name_ar ? d.next.class.name_ar : d.next.class.name}</b>
                      <small>{when(d.next.class.starts_at)} · {minutes(Math.round((new Date(d.next.class.ends_at).getTime() - new Date(d.next.class.starts_at).getTime()) / 60000))}{d.next.class.coach_name ? ` · ${d.next.class.coach_name}` : ""}</small></span>
                    {d.next.class.status === "waitlist" && <span className="m-tag">{t("Waitlist")}</span>}
                  </button>
                )}
                {d.next.pt && (
                  <button className="m-next" onClick={() => go("coach")}>
                    <span className="bar" style={{ background: "var(--brand)" }} />
                    <span className="grow"><b>{t("Personal training")}</b><small>{when(d.next.pt.starts_at)} · {minutes(d.next.pt.duration_min)}{d.next.pt.coach_name ? ` · ${d.next.pt.coach_name}` : ""}</small></span>
                  </button>
                )}
              </div>
            </Section>
          )}

          <button className="m-week" onClick={() => me.features.badges && go("progress")}>
            <Ring value={d.week.visits} goal={d.week.goal} size={70}><b>{d.week.visits}</b><small>/{d.week.goal}</small></Ring>
            <span className="grow">
              <b>{d.week.visits >= d.week.goal ? t("Weekly goal reached") : t("{n} more this week", { n: d.week.goal - d.week.visits })}</b>
              <small>{t("{n} visits this month", { n: d.month.visits })}{d.month.lastMonthSamePoint > 0 ? ` · ${d.month.visits >= d.month.lastMonthSamePoint ? "▲" : "▼"} ${t("vs last month")}` : ""}</small>
            </span>
            {me.features.badges && d.streak > 0 && <span className="m-streak" title={t("week streak")}><Icon name="flame" width={18} height={18} /><b>{d.streak}</b><small>{t("wk")}</small></span>}
          </button>

          {me.features.challenges && d.challenge && (
            <button className="m-challenge" onClick={() => go("progress")}>
              <span className="m-challenge-top"><Icon name="trophy" width={18} height={18} /><b className="grow" dir="auto">{d.challenge.title}</b>
                {d.challenge.rank && <span className="m-tag">#{d.challenge.rank}{d.challenge.participants ? ` / ${d.challenge.participants}` : ""}</span>}</span>
              <Bar value={d.challenge.progress} goal={d.challenge.target} />
              <small className="m-muted">{Math.min(d.challenge.progress, d.challenge.target)} / {d.challenge.target} {d.challenge.metric === "classes" ? t("classes") : t("days")} · {t("ends")} {fmtDate(d.challenge.ends_on, { day: "numeric", month: "short" })}{d.challenge.reward ? ` · ${t("Prize")}: ${d.challenge.reward}` : ""}</small>
            </button>
          )}

          {d.offers.length > 0 && (
            <Section title={t("Offers")}>
              <div className="m-scroll">
                {d.offers.map((o: any) => (
                  <button key={o.id} className="m-offer" onClick={() => setOffer(o)}>
                    {o.has_image ? <span className="m-offer-img"><img src={`/api/public/offers/${o.id}/image`} alt="" loading="lazy" />{o.badge && <span className="m-badge">{o.badge}</span>}</span>
                      : <span className="m-offer-img word" aria-hidden="true"><span dir="auto">{o.badge || (o.kind === "event" ? t("Event") : t("Offer"))}</span></span>}
                    <b dir="auto">{o.title}</b>
                    {o.ends_on && <small className="m-muted">{t("Until")} {fmtDate(o.ends_on, { day: "numeric", month: "short" })}</small>}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {d.featured.length > 0 && (
            <Section title={t("At the gym's shop")} action={<button className="m-link" onClick={() => go("shop")}>{t("See all")}</button>}>
              <div className="m-scroll">
                {d.featured.map((p: any) => (
                  <button key={p.id} className="m-product small" onClick={() => openProduct(p.id)}>
                    <Thumb src={p.has_image ? `/api/public/products/${p.id}/image` : null} icon={p.kind === "bundle" ? "gift" : "bag"} label={getLang() === "ar" && p.name_ar ? p.name_ar : p.name} />
                    <b dir="auto">{getLang() === "ar" && p.name_ar ? p.name_ar : p.name}</b>
                    <small>{money(p.price, p.currency)}{!p.in_stock ? ` · ${t("out of stock")}` : ""}</small>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <InstallCard gym={me.gym} />
          {me.gym.pushEnabled && <NotifyCard />}

          <div className="m-tiles">
            {me.gym.whatsapp && <a className="m-tile" href={`https://wa.me/${String(me.gym.whatsapp).replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" width={22} height={22} /><b>{t("Message the gym")}</b><small>{t("On WhatsApp")}</small></a>}
            {me.features.ai && <button className="m-tile" onClick={() => go("ask")}><Icon name="message" width={22} height={22} /><b>{t("Ask the gym")}</b><small>{t("Prices, hours, your membership")}</small></button>}
            {me.features.referrals && <button className="m-tile" onClick={() => go("me")}><Icon name="gift" width={22} height={22} /><b>{t("Invite a friend")}</b><small>{t("Share your link")}</small></button>}
            {me.features.badges && <button className="m-tile" onClick={() => go("progress")}><Icon name="trophy" width={22} height={22} /><b>{d.badges ?? 0} {t("badges")}</b><small>{t("See your progress")}</small></button>}
          </div>
        </>
      )}
      <PassSheet me={me} open={pass} onClose={() => setPass(false)} />
      <OfferSheet offer={offer} onClose={() => setOffer(null)} onWant={(id) => { setOffer(null); openProduct(id); }} />
    </div>
  );
}

/** Product detail with "I want it". */
export function ProductSheet({ product, onClose, onOrdered }: { product: any; onClose: () => void; onOrdered: () => void }) {
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setQty(1); setNote(""); }, [product?.id]);
  const p = product;
  return (
    <Sheet open={!!p} onClose={onClose} title={p?.kind === "bundle" ? t("Bundle") : t("Product")}
      footer={p && (p.in_stock ? (
        <div className="m-want">
          <span className="m-qty">
            <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label={t("One less")}>−</button><b>{qty}</b><button onClick={() => setQty(Math.min(10, qty + 1))} aria-label={t("One more")}>+</button>
          </span>
          <button className="m-btn grow" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await post("/api/m/shop/requests", { product_id: p.id, qty, note: note || null }); toast(t("Sent! Reception will prepare it.")); onOrdered(); } catch (e) { toastError(e); } finally { setBusy(false); }
          }}>{t("I want it")} · {money(Number(p.price) * qty, p.currency)}</button>
        </div>
      ) : <p className="m-muted" style={{ margin: 0 }}>{t("Out of stock for now. Ask reception when it's back.")}</p>)}>
      {p && (
        <div className="m-detail">
          {p.has_image ? <img className="m-hero-img contain" src={`/api/public/products/${p.id}/image`} alt="" /> : <span className="m-hero-img empty"><Icon name={p.kind === "bundle" ? "gift" : "bag"} width={42} height={42} /></span>}
          <h3 dir="auto">{getLang() === "ar" && p.name_ar ? p.name_ar : p.name}</h3>
          <div className="m-price">{money(p.price, p.currency)}{p.low && <span className="m-tag warn">{t("Few left")}</span>}</div>
          {p.brand && <p className="m-muted" style={{ margin: 0 }}>{p.brand}</p>}
          {p.contents && <p className="m-contents"><Icon name="gift" width={16} height={16} /> {p.contents}</p>}
          {p.description && <p dir="auto">{p.description}</p>}
          {p.in_stock && <input className="m-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Note for reception (flavour, size…)")} maxLength={200} dir="auto" />}
          <p className="m-muted" style={{ fontSize: "0.85rem", margin: 0 }}>{t("You pay at reception when you pick it up. You'll get a notification when it's ready.")}</p>
        </div>
      )}
    </Sheet>
  );
}
