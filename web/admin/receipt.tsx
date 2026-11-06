/** Receipt preview: print it, send the link on WhatsApp, or copy the link. Opened from anywhere with openReceipt(id). */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { get } from "../shared/api.ts";
import { Icon, Modal, Spinner, toast, toastError } from "../shared/ui.tsx";

let current: string | null = null;
const subs = new Set<() => void>();
export function openReceipt(paymentId: string) {
  current = paymentId;
  subs.forEach((f) => f());
}
function close() {
  current = null;
  subs.forEach((f) => f());
}

export function ReceiptHost() {
  const id = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => current);
  const [r, setR] = useState<any>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    setR(null);
    if (!id) return;
    get(`/api/payments/${id}/receipt`).then(setR, (e) => { toastError(e); close(); });
  }, [id]);
  return (
    <Modal title={r ? `Receipt #${r.receipt_no}` : "Receipt"} open={!!id} onClose={close}
      footer={r && (
        <>
          <button className="btn" onClick={async () => {
            try { await navigator.clipboard.writeText(r.url); toast("Link copied"); } catch { prompt("Copy this link", r.url); }
          }}>Copy link</button>
          {r.whatsappLink && <a className="btn" href={r.whatsappLink} target="_blank" rel="noreferrer"><Icon name="whatsapp" />Send to {r.memberName?.split(" ")[0] ?? "member"}</a>}
          <button className="btn primary" onClick={() => frame.current?.contentWindow?.print()}><Icon name="print" />Print</button>
        </>
      )}>
      {!r ? <div className="empty"><Spinner /></div> : (
        <iframe ref={frame} title={`Receipt ${r.receipt_no}`} srcDoc={r.html} style={{ width: "100%", height: 460, border: "1px solid var(--line)", borderRadius: 8, background: "#f4f5f2" }} />
      )}
    </Modal>
  );
}
