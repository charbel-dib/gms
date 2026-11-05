import React, { useEffect, useRef, useState } from "react";
import { del, get, post, put } from "../../shared/api.ts";
import { Empty, Icon, Loader, Status, Tabs, toast, useAction, useAsync } from "../../shared/ui.tsx";
import { fmtDate, relDays, t } from "../../shared/i18n.ts";
import { Link, can, useApp } from "../app.tsx";

const PROMPTS = [
  "How is the gym doing this month?",
  "Who should I call this week to keep them?",
  "Which members still owe money?",
  "When is the gym busiest, and when is it empty?",
  "Which classes are full and which are empty?",
  "chou fi members bi5las ishtirakon hal jem3a?",
  "كيف الإيرادات هالشهر مقارنة بالشهر الماضي؟",
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
      <header><h2>Ask about your gym</h2><span className="muted">English, عربي, Arabizi or français</span></header>
      <div className="body ask">
        {log.length === 0 && <div className="prompts">{PROMPTS.map((p) => <button key={p} onClick={() => ask(p)} dir="auto">{p}</button>)}</div>}
        <div className="ask-log">
          {log.map((x, i) => (
            <React.Fragment key={i}>
              <div className="bubble q" dir="auto">{x.q}</div>
              <div className="bubble a" dir="auto">
                {x.a ? x.a.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^_(.+)_$/gm, "$1") : <span className="muted">Looking at your data…</span>}
                {x.tools?.length ? <span className="meta">Answered from: {x.tools.join(", ").replace(/_/g, " ")}</span> : null}
              </div>
            </React.Fragment>
          ))}
          <div ref={end} />
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question about members, money, classes…" dir="auto" aria-label="Question" />
          <button className="btn primary" disabled={busy || !q.trim()}><Icon name="send" />Ask</button>
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
                  : "Your gym's history is still short, so predictions use GMS's starting model. It switches to a model trained on your members once there are about 60 finished memberships."}
              </p>
              {can(me, "owner", "manager") && <button className="btn" disabled={busy} onClick={async () => { await run(() => post("/api/ai/churn/refresh"), "Predictions updated"); state.reload(); }}><Icon name="refresh" />Update now</button>}
            </div>
            <section className="panel">
              <header><h2>Likely to leave ({risky.length})</h2><span className="muted">active members</span></header>
              {risky.length ? (
                <div className="table-wrap" style={{ border: 0 }}><table className="data">
                  <thead><tr><th>Member</th><th>Risk</th><th>Why</th><th>{t("Ends")}</th><th /></tr></thead>
                  <tbody>{risky.map((r: any) => (
                    <tr key={r.id}>
                      <td><Link to={`/members/${r.id}`} className="who" style={{ textDecoration: "none" }}><b>{r.first_name} {r.last_name}</b><small>{r.plan_name} · last visit {relDays(r.last_checkin)}</small></Link></td>
                      <td><span className="risk-bar"><span style={{ width: `${Math.round(r.score * 100)}%` }} /></span> {Math.round(r.score * 100)}%</td>
                      <td><ul className="reasons">{(r.reasons ?? []).map((x: string) => <li key={x}>{x}</li>)}</ul></td>
                      <td><Status s={r.status} label={fmtDate(r.end_date)} /></td>
                      <td className="r"><Link className="btn small" to={`/members/${r.id}`}><Icon name="whatsapp" />Reach out</Link></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <Empty title="Nobody looks at risk right now." />}
            </section>
            <section className="panel">
              <header><h2>Recently lapsed ({lapsed.length})</h2><span className="muted">expired in the last 30 days, not renewed</span></header>
              <div className="list">{lapsed.slice(0, 30).map((r: any) => (
                <Link key={r.id} to={`/members/${r.id}`} style={{ textDecoration: "none" }}>
                  <span className="plate" data-s="expired" />
                  <span className="grow who"><b>{r.first_name} {r.last_name}</b><small>ended {fmtDate(r.end_date)} · {r.plan_name}</small></span>
                  <span className="muted">{Math.round(r.score * 100)}% likely gone</span>
                </Link>
              ))}{!lapsed.length && <div className="muted">None.</div>}</div>
            </section>
          </div>
        );
      }}
    </Loader>
  );
}

function BotTest() {
  const [text, setText] = useState("adesh l ishtirak bel chahr?");
  const [r, setR] = useState<any>(null);
  const { busy, run } = useAction();
  const kb = useAsync(() => get("/api/ai/knowledge"), []);
  const [doc, setDoc] = useState<any>(null);
  return (
    <div className="cols">
      <section className="panel">
        <header><h2>Try the member assistant</h2><span className="muted">as a member would write on WhatsApp</span></header>
        <div className="body stack">
          <form className="row" onSubmit={async (e) => { e.preventDefault(); setR(await run(() => post("/api/ai/bot-test", { text }))); }}>
            <input className="input" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} dir="auto" aria-label="Member message" />
            <button className="btn primary" disabled={busy}>Send</button>
          </form>
          {r && (
            <div className="stack-s">
              <div className="bubble a" dir="auto">{r.reply}</div>
              <small className="muted">{r.handoff ? "Would be handed to reception. " : ""}Sources: {r.sources.map((s: any) => s.title).join(" · ") || "none"} · {r.mode === "llm" ? "AI" : "offline mode"}</small>
            </div>
          )}
          <p className="muted" style={{ fontSize: "0.85rem" }}>The assistant already knows your prices, hours, ladies hours, class schedule and coaches from your settings. Add anything else on the right.</p>
        </div>
      </section>
      <section className="panel">
        <header><h2>What the assistant knows</h2><button className="btn small" onClick={() => setDoc({ title: "", body: "" })}><Icon name="plus" />Add</button></header>
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
            <input className="input" placeholder="Title, e.g. Parking" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
            <textarea className="input" placeholder="What members should know" value={doc.body} onChange={(e) => setDoc({ ...doc, body: e.target.value })} dir="auto" />
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
  const [tab, setTab] = useState<"risk" | "ask" | "bot">(can(me, "owner", "manager") ? "ask" : "risk");
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Insights")}</h1><p>Predictions and answers computed from your own gym's data.{status.data && !status.data.llm ? " Running in offline mode." : ""}</p></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        ...(can(me, "owner", "manager") ? [{ value: "ask" as const, label: "Ask" }] : []),
        { value: "risk", label: "Members at risk" },
        { value: "bot", label: "Member assistant" },
      ]} />
      {tab === "ask" && <Ask />}
      {tab === "risk" && <Churn />}
      {tab === "bot" && <BotTest />}
    </div>
  );
}
