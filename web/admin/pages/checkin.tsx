import React, { useEffect, useRef, useState } from "react";
import { get } from "../../shared/api.ts";
import { Icon, Status, toastError, useAsync } from "../../shared/ui.tsx";
import { fmtDate, fmtTime, money, t } from "../../shared/i18n.ts";
import { Link, clearLast, doCheckin, looksLikeQr, useCheckins, type CheckinResult } from "../app.tsx";

function verdictState(r: CheckinResult) {
  if (r.result === "denied") return r.reason === "frozen" ? "frozen" : "denied";
  return r.warnings.length ? "warn" : "ok";
}

/** Camera scanning where the browser supports BarcodeDetector (Chrome on Android, macOS, ChromeOS). */
function CameraScanner({ onCode }: { onCode: (s: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const supported = typeof (window as any).BarcodeDetector !== "undefined";
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let stop = false;
    let lastCode = "";
    let lastAt = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.current!.srcObject = stream;
        await video.current!.play();
        const det = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
        while (!stop) {
          const codes = await det.detect(video.current!).catch(() => []);
          const v = codes[0]?.rawValue;
          if (v && (v !== lastCode || Date.now() - lastAt > 4000)) {
            lastCode = v;
            lastAt = Date.now();
            onCode(v);
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e) {
        toastError(new Error("Camera unavailable. Allow camera access, or use a USB scanner."));
        setOn(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [on]);
  if (!supported) return <p className="muted" style={{ fontSize: "0.85rem" }}>Tip: plug a USB QR scanner (about $25) into this computer — it types into the scan bar.</p>;
  return (
    <div className="stack-s">
      <button className="btn" onClick={() => setOn((x) => !x)}><Icon name="camera" />{on ? "Stop camera" : "Scan with camera"}</button>
      {on && <video ref={video} muted playsInline style={{ width: "100%", borderRadius: 10, background: "#000" }} />}
    </div>
  );
}

export function CheckinPage() {
  const { last, feed } = useCheckins();
  const today = useAsync(() => get("/api/checkins"), [last?.at]);
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!last) return;
    const id = setTimeout(() => clearLast(), 12_000);
    return () => clearTimeout(id);
  }, [last?.at]);

  const submit = async (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    try {
      if (looksLikeQr(s)) await doCheckin({ token: s });
      else if (/^\d+$/.test(s)) await doCheckin({ code: Number(s) });
      else throw new Error("Scan a QR code or type a member number. To search by name, use the bar at the top.");
    } catch (e) {
      toastError(e);
    }
    setCode("");
    inputRef.current?.focus();
  };

  const m = last?.member;
  const state = last ? verdictState(last) : undefined;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Check-in")}</h1><p>Scan the member's QR code or type their number, then press Enter.</p></div>
      </div>
      <div className="gate">
        <section className="gate-card" data-s={state} aria-live="assertive" onClick={(e) => { if (!last && !(e.target as HTMLElement).closest("input,button,a")) inputRef.current?.focus(); }}>
          {!last ? (
            <div className="gate-idle">
              <div className="big-plate" />
              <h2 style={{ fontSize: "var(--step-2)" }}>{t("Ready to scan")}</h2>
              <form onSubmit={(e) => { e.preventDefault(); submit(code); }} style={{ display: "flex", gap: 8, width: "100%" }}>
                <input ref={inputRef} className="input" inputMode="numeric" placeholder="Member number or QR" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Member number or QR code" />
                <button className="btn primary">Check in</button>
              </form>
            </div>
          ) : (
            <div className="gate-inner">
              <div className="big-plate"><Icon name={last.result === "ok" ? "check" : "x"} width={64} height={64} strokeWidth={2.6} /></div>
              <div className="gate-verdict">
                {last.result === "ok" ? (last.duplicate ? "Already checked in" : t("Entry allowed")) : t("Entry refused")}
                {last.reason && <> — {t(last.reason)}</>}
              </div>
              <div className="gate-name">{m.first_name} {m.last_name}</div>
              <div className="gate-meta">
                <span>#{m.code}</span>
                <span>{m.plan_name ?? "No membership"}</span>
                {m.end_date && <span>{t("Ends")} {fmtDate(m.end_date, { day: "numeric", month: "short", year: "numeric" })}{m.days_left >= 0 ? ` · ${m.days_left} ${t("days left")}` : ""}</span>}
                {m.visits_total != null && <span>{m.visits_total - m.visits_used} {t("visits left")}</span>}
              </div>
              <div className="row" style={{ justifyContent: "center" }}>
                {last.warnings.map((w) => <span key={w} className="gate-warn">{t(w)}{w === "unpaid_balance" ? ` ${money(m.balance_usd)}` : ""}</span>)}
              </div>
              <div className="row" style={{ justifyContent: "center", marginTop: 6 }}>
                <Link className="btn" to={`/members/${m.id}`}>Open profile</Link>
                {(last.result === "denied" || m.status === "expiring") && <Link className="btn primary" to={`/members/${m.id}?sell=1`}>{t("Renew")}</Link>}
                <button className="btn ghost" onClick={() => { clearLast(); setTimeout(() => inputRef.current?.focus(), 50); }}>Next member</button>
              </div>
            </div>
          )}
        </section>
        <aside className="stack">
          <section className="panel">
            <header><h2>Camera</h2></header>
            <div className="body"><CameraScanner onCode={submit} /></div>
          </section>
          <section className="panel feed">
            <header><h2>Last 24 hours</h2><span className="muted">{today.data?.filter((c: any) => c.result === "ok").length ?? 0} entries</span></header>
            <div className="list" style={{ maxHeight: 420, overflowY: "auto" }}>
              {(today.data ?? []).slice(0, 40).map((c: any) => (
                <Link key={c.id} to={`/members/${c.member_id}`} style={{ textDecoration: "none" }}>
                  <span className="plate" data-s={c.result === "ok" ? "ok" : "denied"} />
                  <span className="grow who"><b>{c.first_name} {c.last_name}</b><small>{c.result === "ok" ? "Entered" : t(c.reason ?? "denied")}</small></span>
                  <span className="muted">{fmtTime(c.at)}</span>
                </Link>
              ))}
              {today.data?.length === 0 && <div className="muted">Nobody yet today.</div>}
            </div>
          </section>
        </aside>
      </div>
      {feed.length > 0 && <p className="muted" style={{ fontSize: "0.85rem" }}>This session: {feed.filter((f) => f.result === "ok").length} allowed, {feed.filter((f) => f.result === "denied").length} refused.</p>}
    </div>
  );
}
