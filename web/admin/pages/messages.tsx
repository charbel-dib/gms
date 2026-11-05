import React, { useState } from "react";
import { get, post } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, toast, useAction, useAsync } from "../../shared/ui.tsx";
import { fmtDate, fmtTime, t } from "../../shared/i18n.ts";
import { Link, can, useApp } from "../app.tsx";

const KIND: Record<string, string> = {
  reminder_expiry: "Renewal reminder", winback: "Win-back", waitlist_promoted: "Waitlist spot", class_cancelled: "Class cancelled",
  broadcast: "Broadcast", manual: "Manual", bot: "Assistant reply", bot_handoff: "Needs a person", inbound: "Received",
};

export function MessagesPage() {
  const { me } = useApp();
  const [filter, setFilter] = useState<"outbox" | "all" | "inbox" | "failed">("outbox");
  const state = useAsync(() => get(`/api/messages?status=${filter}`), [filter]);
  const [bc, setBc] = useState(false);
  const { busy, run } = useAction();
  const connected = !!me.gym?.settings?.whatsapp?.phoneNumberId && me.gym?.settings?.whatsapp?.hasToken;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("Messages")}</h1>
          <p>{connected ? "WhatsApp Business is connected: reminders are sent automatically." : "Click-to-send mode: each message opens WhatsApp ready to send from the gym's phone."}</p>
        </div>
        <div className="row">
          {can(me, "owner", "manager") && <button className="btn" disabled={busy} onClick={async () => { const r = await run(() => post("/api/messages/reminders/run")); if (r) { toast(`${r.sent + r.queued} reminder(s) prepared`); state.reload(); } }}><Icon name="refresh" />Prepare today's reminders</button>}
          {can(me, "owner", "manager") && <button className="btn primary" onClick={() => setBc(true)}><Icon name="send" />Message a group</button>}
        </div>
      </div>
      <Segmented label="Filter" value={filter} onChange={setFilter} options={[
        { value: "outbox", label: `To send${state.data?.counts?.outbox ? ` ${state.data.counts.outbox}` : ""}` },
        { value: "inbox", label: "Received" }, { value: "failed", label: "Failed" }, { value: "all", label: "All" },
      ]} />
      <Loader state={state}>
        {(d: any) => d.rows.length ? (
          <div className="table-wrap"><table className="data">
            <tbody>{d.rows.map((m: any) => (
              <tr key={m.id}>
                <td style={{ width: 160 }}><span className="who"><b>{m.member_id ? <Link to={`/members/${m.member_id}`}>{m.first_name} {m.last_name}</Link> : m.phone}</b><small>{fmtDate(m.created_at)} {fmtTime(m.created_at)}</small></span></td>
                <td><span className="tag">{KIND[m.kind] ?? m.kind}</span><p style={{ whiteSpace: "pre-wrap", marginTop: 6 }} dir="auto">{m.body}</p>{m.error && <small className="money-neg">{m.error}</small>}</td>
                <td className="r" style={{ width: 170 }}>
                  {m.link ? (
                    <a className="btn small primary" href={m.link} target="_blank" rel="noreferrer" onClick={() => setTimeout(async () => { await post(`/api/messages/${m.id}/done`); state.reload(); }, 800)}><Icon name="whatsapp" />Send</a>
                  ) : <span className="tag">{m.status}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title={filter === "outbox" ? "Nothing to send. You're up to date." : "No messages."} />}
      </Loader>
      <BroadcastModal open={bc} onClose={() => { setBc(false); state.reload(); }} />
    </div>
  );
}

function BroadcastModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [segment, setSegment] = useState("expired_30");
  const [body, setBody] = useState("Hi {name}! ");
  const [preview, setPreview] = useState<any>(null);
  const { busy, run } = useAction();
  const segs: Record<string, string> = { active: "Active members", expiring: "Ending this week", expired_30: "Expired in the last 30 days", expired_90: "Expired in the last 90 days", at_risk: "At risk of leaving", unpaid: "With an unpaid balance", women: "Active women", all: "Everyone" };
  return (
    <Modal title="Message a group" open={open} onClose={() => { setPreview(null); onClose(); }}
      footer={<>
        <button className="btn" disabled={busy} onClick={async () => setPreview(await run(() => post("/api/messages/broadcast", { segment, body, preview: true })))}>Preview</button>
        <button className="btn primary" disabled={busy || !preview} onClick={async () => { const r = await run(() => post("/api/messages/broadcast", { segment, body })); if (r) { toast(`${r.count} messages prepared`); onClose(); } }}>Prepare {preview?.count ?? ""} messages</button>
      </>}>
      <Field label="Who"><select className="input" value={segment} onChange={(e) => { setSegment(e.target.value); setPreview(null); }}>{Object.entries(segs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Message" hint="{name} is replaced by the member's first name."><textarea className="input" value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} dir="auto" /></Field>
      {preview && <p className="ink-2">{preview.count} people. Example: “{preview.sample[0]?.text ?? "—"}”</p>}
      <p className="muted" style={{ fontSize: "0.85rem" }}>Only members who accept WhatsApp messages are included.</p>
    </Modal>
  );
}
