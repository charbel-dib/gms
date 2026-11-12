import React, { useEffect, useRef, useState } from "react";
import { del, get, post, put } from "../../shared/api.ts";
import { Empty, Icon, Loader, Status, Tabs, toast, useAction, useAsync } from "../../shared/ui.tsx";
import { fmtDate, relDays, t } from "../../shared/i18n.ts";
import { Link, can, moduleOn, useApp, usePath } from "../app.tsx";
import { KpisView } from "./kpis.tsx";

const PROMPTS = [
  "How is the gym doing this month?",
  "Who should I call this week to keep them?",
  "Which members still owe money?",
  "When is the gym busiest, and when is it empty?",
  "Which classes are full and which are empty?",
  "Whose membership ends this week?",
  "كيف كانت الإيرادات هذا الشهر مقارنة بالشهر الماضي؟",
];

function Ask() {
  const [log, setLog] = useState<{ q: string; a?: string; mode?: string; tools?: string[] }[]>([]);
  const [q, setQ] = useState("");
  const { busy, run } = useAction();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [log]);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    const history = log.flatMap((x) => (x.a ? [{ role: "user" as const, content: x.q }, { role: "assistant" as const, content: x.a }] : []));
    setLog((l) => [...l, { q: question }]);
    setQ("");
    const r = await run(() => post("/api/ai/ask", { question, history }));
    setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, a: r?.answer ?? "No answer.", mode: r?.mode, tools: r?.toolsUsed } : x)));
  };
  return (
    <section className="panel">
      <header><h2>{t("Ask about your gym")}</h2><span className="muted">{t("Ask in English or Arabic")}</span></header>
      <div className="body ask">
        {log.length === 0 && <div className="prompts">{PROMPTS.map((p) => <button key={p} onClick={() => ask(p)} dir="auto">{p}</button>)}</div>}
        <div className="ask-log">
          {log.map((x, i) => (
            <React.Fragment key={i}>
              <div className="bubble q" dir="auto">{x.q}</div>
              <div className="bubble a" dir="auto">
                {x.a ? x.a.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^_(.+)_$/gm, "$1") : <span className="muted">{t("Looking at your data…")}</span>}
                {x.tools?.length ? <span className="meta">{t("Answered from:")}{" "}{x.tools.join(", ").replace(/_/g, " ")}</span> : null}
              </div>
            </React.Fragment>
          ))}
          <div ref={end} />
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Ask a question about members, money, classes…")} dir="auto" aria-label={t("Question")} />
          <button className="btn primary" disabled={busy || !q.trim()}><Icon name="send" />{t("Ask")}</button>
        </form>
      </div>
    </section>
  );
}

function Churn() {
  const { me } = useApp();
  const state = useAsync(() => get("/api/ai/churn"), []);
  const { busy, run } = useAction();
  return (
    <Loader state={state}>
      {(d: any) => {
        const risky = d.rows.filter((r: any) => r.score >= 0.6 && ["active", "expiring"].includes(r.status));
        const lapsed = d.rows.filter((r: any) => r.status === "expired");
        const m = d.model;
        return (
          <div className="stack">
            <div className="spread">
              <p className="ink-2" style={{ maxWidth: "70ch" }}>
                {m?.kind === "logreg"
                  ? `Prediction trained on your gym's own history: ${m.metrics.samples} past memberships, accuracy (AUC) ${m.metrics.auc}. Updated ${relDays(m.trained_at)}.`
                  : t("Your gym's history is still short, so predictions use GMS's starting model. It switches to a model trained on your members once there are about 60 finished memberships.")}
              </p>
              {can(me, "owner", "manager") && <button className="btn" disabled={busy} onClick={async () => { await run(() => post("/api/ai/churn/refresh"), "Predictions updated"); state.reload(); }}><Icon name="refresh" />{t("Update now")}</button>}
            </div>
            <section className="panel">
              <header><h2>{t("Likely to leave (")}{risky.length})</h2><span className="muted">{t("active members")}</span></header>
              {risky.length ? (
                <div className="table-wrap" style={{ border: 0 }}><table className="data">
                  <thead><tr><th>{t("Member")}</th><th>{t("Risk")}</th><th>{t("Why")}</th><th>{t("Ends")}</th><th /></tr></thead>
                  <tbody>{risky.map((r: any) => (
                    <tr key={r.id}>
                      <td><Link to={`/members/${r.id}`} className="who" style={{ textDecoration: "none" }}><b>{r.first_name} {r.last_name}</b><small>{r.plan_name} {t("· last visit")}{" "}{relDays(r.last_checkin)}</small></Link></td>
                      <td><span className="risk-bar"><span style={{ width: `${Math.round(r.score * 100)}%` }} /></span> {Math.round(r.score * 100)}%</td>
                      <td><ul className="reasons">{(r.reasons ?? []).map((x: string) => <li key={x}>{x}</li>)}</ul></td>
                      <td><Status s={r.status} label={fmtDate(r.end_date)} /></td>
                      <td className="r"><Link className="btn small" to={`/members/${r.id}`}><Icon name="whatsapp" />{t("Reach out")}</Link></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <Empty title={t("Nobody looks at risk right now.")} />}
            </section>
            <section className="panel">
              <header><h2>{t("Recently lapsed (")}{lapsed.length})</h2><span className="muted">{t("expired in the last 30 days, not renewed")}</span></header>
              <div className="list">{lapsed.slice(0, 30).map((r: any) => (
                <Link key={r.id} to={`/members/${r.id}`} style={{ textDecoration: "none" }}>
                  <span className="plate" data-s="expired" />
                  <span className="grow who"><b>{r.first_name} {r.last_name}</b><small>ended {fmtDate(r.end_date)} · {r.plan_name}</small></span>
                  <span className="muted">{Math.round(r.score * 100)}{t("% likely gone")}</span>
                </Link>
              ))}{!lapsed.length && <div className="muted">{t("None.")}</div>}</div>
            </section>
          </div>
        );
      }}
    </Loader>
  );
}

function BotTest() {
  const [text, setText] = useState("How much is a monthly membership?");
  const [r, setR] = useState<any>(null);
  const { busy, run } = useAction();
  const kb = useAsync(() => get("/api/ai/knowledge"), []);
  const [doc, setDoc] = useState<any>(null);
  return (
    <div className="cols">
      <section className="panel">
        <header><h2>{t("Try the member assistant")}</h2><span className="muted">{t("as a member would write on WhatsApp")}</span></header>
        <div className="body stack">
          <form className="row" onSubmit={async (e) => { e.preventDefault(); setR(await run(() => post("/api/ai/bot-test", { text }))); }}>
            <input className="input" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} dir="auto" aria-label={t("Member message")} />
            <button className="btn primary" disabled={busy}>{t("Send")}</button>
          </form>
          {r && (
            <div className="stack-s">
              <div className="bubble a" dir="auto">{r.reply}</div>
              <small className="muted">{r.handoff ? t("Would be handed to reception. ") : ""}{t("Sources:")}{" "}{r.sources.map((s: any) => s.title).join(" · ") || "none"} · {r.mode === "llm" ? "AI" : t("offline mode")}</small>
            </div>
          )}
          <p className="muted" style={{ fontSize: "0.85rem" }}>{t("The assistant already knows your prices, hours, ladies hours, class schedule and coaches from your settings. Add anything else on the right.")}</p>
        </div>
      </section>
      <section className="panel">
        <header><h2>{t("What the assistant knows")}</h2><button className="btn small" onClick={() => setDoc({ title: "", body: "" })}><Icon name="plus" />{t("Add")}</button></header>
        <Loader state={kb}>
          {(list: any[]) => (
            <div className="list">{list.map((d) => (
              <button key={d.id} className="btn ghost" style={{ justifyContent: "flex-start", textAlign: "start", height: "auto", padding: "10px 18px", borderRadius: 0 }} onClick={() => setDoc(d)}>
                <span className="who"><b>{d.title}</b><small style={{ whiteSpace: "normal" }}>{d.body.slice(0, 90)}{d.body.length > 90 ? "…" : ""}</small></span>
              </button>
            ))}</div>
          )}
        </Loader>
        {doc && (
          <div className="body stack-s" style={{ borderTop: "1px solid var(--line)" }}>
            <input className="input" placeholder={t("Title, e.g. Parking")} value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
            <textarea className="input" placeholder={t("What members should know")} value={doc.body} onChange={(e) => setDoc({ ...doc, body: e.target.value })} dir="auto" />
            <div className="row">
              <button className="btn primary small" disabled={!doc.title || !doc.body} onClick={async () => {
                await run(() => (doc.id ? put(`/api/ai/knowledge/${doc.id}`, { title: doc.title, body: doc.body }) : post("/api/ai/knowledge", { title: doc.title, body: doc.body })), t("Save"));
                setDoc(null); kb.reload();
              }}>{t("Save")}</button>
              {doc.id && <button className="btn small danger" onClick={async () => { await run(() => del(`/api/ai/knowledge/${doc.id}`)); setDoc(null); kb.reload(); }}>{t("Delete")}</button>}
              <button className="btn small ghost" onClick={() => setDoc(null)}>{t("Cancel")}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function InsightsPage() {
  const { me } = useApp();
  const status = useAsync(() => get("/api/ai/status"), []);
  const path = usePath();
  const wanted = new URLSearchParams(path.split("?")[1] ?? "").get("tab");
  const boss = can(me, "owner", "manager");
  const ai = moduleOn(me, "ai");
  const [tab, setTab] = useState<"kpis" | "risk" | "ask" | "bot">(
    (["kpis", "risk", "ask", "bot"] as const).find((x) => x === wanted && (boss || x === "risk")) ?? (boss ? "kpis" : "risk"));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Insights")}</h1><p>{t("Predictions and answers computed from your own gym's data.")}{status.data && !status.data.llm ? t(" Running in offline mode.") : ""}</p></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        ...(boss ? [{ value: "kpis" as const, label: t("Key numbers") }] : []),
        ...(ai && boss ? [{ value: "ask" as const, label: t("Ask") }] : []),
        ...(ai ? [{ value: "risk" as const, label: t("Members at risk") }] : []),
        ...(ai && boss ? [{ value: "bot" as const, label: t("Member assistant") }] : []),
      ]} />
      {tab === "kpis" && <KpisView />}
      {tab === "ask" && <Ask />}
      {tab === "risk" && <Churn />}
      {tab === "bot" && <BotTest />}
    </div>
  );
}
