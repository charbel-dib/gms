/**
 * Telegram controls for the back office: connecting your own Telegram (weekly summary, alerts),
 * connecting a member (reminders, the assistant), and the gym's on/off switch.
 */
import React, { useEffect, useState } from "react";
import { api, get, post } from "../shared/api.ts";
import { Icon, toast, toastError, useAsync } from "../shared/ui.tsx";
import { t } from "../shared/i18n.ts";
import { qrSvg } from "../shared/qr.ts";

/** A link to open on the phone: a button for this device, and a QR code for a phone next to the computer. */
function OpenLink({ url, note }: { url: string; note: string }) {
  return (
    <div className="tg-open">
      <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
      <div className="stack-s">
        <p className="ink-2" style={{ fontSize: "0.9rem" }}>{note}</p>
        <a className="btn small primary" href={url} target="_blank" rel="noreferrer"><Icon name="send" />{t("Open Telegram")}</a>
        <small className="muted">{t("The link works once and for 7 days.")}</small>
      </div>
    </div>
  );
}

/** Waits for the person to press Start in Telegram, then refreshes. */
function useWaitFor(active: boolean, check: () => Promise<boolean>, onDone: () => void) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(async () => { if (await check().catch(() => false)) { clearInterval(id); onDone(); } }, 3000);
    return () => clearInterval(id);
  }, [active]);
}

/** Your own Telegram: owners and managers get the weekly summary there and can ask about their numbers; the operator gets alerts. */
export function MyTelegram({ purpose }: { purpose: string }) {
  const s = useAsync(() => get("/api/telegram"), []);
  const [link, setLink] = useState<string | null>(null);
  useWaitFor(!!link, async () => (await get<any>("/api/telegram")).me_linked, () => { setLink(null); s.reload(); toast(t("Telegram connected")); });
  const d: any = s.data;
  if (!d) return null;
  if (!d.bot) return <p className="muted">{t("Telegram isn't set up on GMS yet.")}</p>;
  if (d.me_linked) {
    return (
      <div className="spread">
        <span><Icon name="check" /> {t("Connected")}{d.me_username ? ` (@${d.me_username})` : ""}</span>
        <button className="btn small ghost" onClick={async () => { await api("/api/telegram/me", { method: "DELETE" }); s.reload(); }}>{t("Disconnect")}</button>
      </div>
    );
  }
  return link ? <OpenLink url={link} note={t("Open it on your phone and press Start.")} /> : (
    <div className="stack-s">
      <p className="ink-2">{purpose}</p>
      <div><button className="btn small" onClick={async () => { try { setLink((await post<any>("/api/telegram/me")).url); } catch (e) { toastError(e); } }}><Icon name="send" />{t("Connect my Telegram")}</button></div>
    </div>
  );
}

/** On a member's profile: is their Telegram connected, and how to send them the link. */
export function MemberTelegram({ memberId, name }: { memberId: string; name: string }) {
  const gym = useAsync(() => get("/api/telegram"), []);
  const s = useAsync(() => get(`/api/members/${memberId}/telegram`), [memberId]);
  const [link, setLink] = useState<any>(null);
  useWaitFor(!!link, async () => (await get<any>(`/api/members/${memberId}/telegram`)).linked, () => { setLink(null); s.reload(); toast(t("{name} is connected on Telegram", { name })); });
  const g: any = gym.data, d: any = s.data;
  if (!g?.bot || !g.enabled || !d) return null;
  return (
    <section className="panel">
      <header><h2>{t("Telegram")}</h2>{d.linked && <span className="muted">{d.username ? `@${d.username}` : t("Connected")}</span>}</header>
      <div className="body stack-s">
        {d.linked ? (
          <>
            <p className="ink-2" style={{ fontSize: "0.9rem" }}>{t("Reminders and messages go to their Telegram, and the assistant answers their questions there.")}</p>
            <div><button className="btn small ghost" onClick={async () => { await api(`/api/members/${memberId}/telegram`, { method: "DELETE" }); s.reload(); }}>{t("Disconnect")}</button></div>
          </>
        ) : link ? (
          <>
            {link.whatsapp && <a className="btn small" href={link.whatsapp} target="_blank" rel="noreferrer"><Icon name="whatsapp" />{t("Send the link on WhatsApp")}</a>}
            <OpenLink url={link.url} note={t("Or let them scan this with their phone, then press Start.")} />
          </>
        ) : (
          <>
            <p className="ink-2" style={{ fontSize: "0.9rem" }}>{t("Not connected. Their messages are prepared for WhatsApp.")}</p>
            <div><button className="btn small" onClick={async () => { try { setLink(await post(`/api/members/${memberId}/telegram`)); } catch (e) { toastError(e); } }}><Icon name="send" />{t("Connect their Telegram")}</button></div>
          </>
        )}
      </div>
    </section>
  );
}
