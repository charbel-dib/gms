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
          <p>{connected ? t("WhatsApp Business is connected: reminders are sent automatically.") : t("Click-to-send mode: each message opens WhatsApp ready to send from the gym's phone.")}</p>
        </div>
        <div className="row">
          {can(me, "owner", "manager") && <button className="btn" disabled={busy} onClick={async () => { const r = await run(() => post("/api/messages/reminders/run")); if (r) { toast(`${r.sent + r.queued} reminder(s) prepared`); state.reload(); } }}><Icon name="refresh" />{t("Prepare today's reminders")}</button>}
          {can(me, "owner", "manager") && <button className="btn primary" onClick={() => setBc(true)}><Icon name="send" />{t("Message a group")}</button>}
        </div>
      </div>
      <Segmented label={t("Filter")} value={filter} onChange={setFilter} options={[
        { value: "outbox", label: `${t("To send")}${state.data?.counts?.outbox ? ` ${state.data.counts.outbox}` : ""}` },
        { value: "inbox", label: t("Received") }, { value: "failed", label: t("Failed") }, { value: "all", label: t("All") },
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
                    <a className="btn small primary" href={m.link} target="_blank" rel="noreferrer" onClick={() => setTimeout(async () => { await post(`/api/messages/${m.id}/done`); state.reload(); }, 800)}><Icon name="whatsapp" />{t("Send")}</a>
                  ) : <span className="tag">{m.status}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title={filter === "outbox" ? t("Nothing to send. You're up to date.") : t("No messages.")} />}
      </Loader>
      <BroadcastModal open={bc} onClose={() => { setBc(false); state.reload(); }} />
    </div>
  );
}

function BroadcastModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [segment, setSegment] = useState("expired_30");
  const [channel, setChannel] = useState<"whatsapp" | "push" | "both">("whatsapp");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("Hi {name}! ");
  const [preview, setPreview] = useState<any>(null);
  const { busy, run } = useAction();
  const segs: Record<string, string> = { active: "Active members", expiring: "Ending this week", expired_30: "Expired in the last 30 days", expired_90: "Expired in the last 90 days", at_risk: "At risk of leaving", unpaid: "With an unpaid balance", women: "Active women", all: "Everyone" };
  const payload = { segment, channel, title, body };
  return (
    <Modal title={t("Message a group")} open={open} onClose={() => { setPreview(null); onClose(); }}
      footer={<>
        <button className="btn" disabled={busy} onClick={async () => setPreview(await run(() => post("/api/messages/broadcast", { ...payload, preview: true })))}>{t("Preview")}</button>
        <button className="btn primary" disabled={busy || !preview || !preview.count} onClick={async () => {
          const r = await run(() => post("/api/messages/broadcast", payload));
          if (r) { toast([r.sent + r.queued ? `${r.sent + r.queued} WhatsApp message(s) prepared` : "", r.pushed ? `${r.pushed} notification(s) sent` : ""].filter(Boolean).join(" · ") || "Nothing to send"); setPreview(null); onClose(); }
        }}>{t("Send to")}{" "}{preview?.count ?? ""} {preview?.count === 1 ? "person" : "people"}</button>
      </>}>
      <Field label={t("Who")}><select className="input" value={segment} onChange={(e) => { setSegment(e.target.value); setPreview(null); }}>{Object.entries(segs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label={t("Send by")}>
        <Segmented label={t("Send by")} value={channel} onChange={(c) => { setChannel(c); setPreview(null); }} options={[{ value: "whatsapp", label: t("WhatsApp") }, { value: "push", label: t("App notification") }, { value: "both", label: t("Both") }]} />
      </Field>
      {channel !== "whatsapp" && <Field label={t("Notification title")} hint={t("Leave empty to use the gym's name")}><input className="input" value={title} maxLength={80} onChange={(e) => { setTitle(e.target.value); setPreview(null); }} placeholder={t("New Zumba class on Saturdays")} dir="auto" /></Field>}
      <Field label={t("Message")} hint={t("{name} is replaced by the member's first name.")}><textarea className="input" value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} dir="auto" /></Field>
      {preview && (
        <p className="ink-2">
          {preview.count} {preview.count === 1 ? "person" : "people"}
          {channel !== "push" && <> · {preview.whatsapp} {t("by WhatsApp")}</>}
          {channel !== "whatsapp" && <> · {preview.push} {t("by app notification")}</>}
          {preview.sample[0] && <>{t(". Example: “")}{preview.sample[0].text}”</>}
        </p>
      )}
      <p className="muted" style={{ fontSize: "0.85rem" }}>{t("WhatsApp: only members who accept WhatsApp messages. App notification: only members who turned notifications on in the app; it waits for the end of quiet hours.")}</p>
    </Modal>
  );
}
