/** Financial report preview: save as PDF / print, or download the Excel file. Opened with openFinanceReport(from, to). */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { get, getGymOverride } from "../shared/api.ts";
import { Icon, Modal, Spinner, toast, toastError } from "../shared/ui.tsx";

let current: { from: string; to: string } | null = null;
const subs = new Set<() => void>();
export function openFinanceReport(from: string, to: string) {
  current = { from, to };
  subs.forEach((f) => f());
}
function close() {
  current = null;
  subs.forEach((f) => f());
}

/** Downloads a file from the API with the session (and the gym a platform admin has open). */
export async function downloadFile(url: string, fallbackName: string) {
  const gym = getGymOverride();
  const res = await fetch(url, { credentials: "same-origin", headers: gym ? { "X-Gym-Id": gym } : {} });
  if (!res.ok) {
    let msg = "Download failed";
    try { msg = (await res.json()).message ?? msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ReportHost() {
  const p = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => current);
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    setR(null);
    if (!p) return;
    get(`/api/reports/finance/report?from=${p.from}&to=${p.to}`).then(setR, (e) => { toastError(e); close(); });
  }, [p]);
  return (
    <Modal title="Financial report" open={!!p} onClose={close} wide
      footer={r && (
        <>
          <span className="muted grow" style={{ fontSize: "var(--step--1)" }}>To save a PDF: Print, then choose “Save as PDF”.</span>
          <button className="btn" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await downloadFile(`/api/reports/finance/report.xlsx?from=${r.from}&to=${r.to}`, "financial-report.xlsx"); toast("Excel file downloaded"); }
            catch (e) { toastError(e); } finally { setBusy(false); }
          }}><Icon name="download" />Excel</button>
          <button className="btn primary" onClick={() => frame.current?.contentWindow?.print()}><Icon name="print" />PDF / Print</button>
        </>
      )}>
      {!r ? <div className="empty"><Spinner /></div> : (
        <iframe ref={frame} title="Financial report" srcDoc={r.html} className="report-frame" />
      )}
    </Modal>
  );
}
