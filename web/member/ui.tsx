/** Small building blocks of the member app. */
import React, { useEffect, useRef } from "react";
import { Icon } from "../shared/ui.tsx";
import { fmtDate, fmtTime, getLang, t } from "../shared/i18n.ts";

export type View = "home" | "classes" | "coach" | "shop" | "me" | "inbox" | "progress" | "settings" | "ask";

/** A bottom sheet (dialog) for details: product, offer, pass, booking. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="m-sheet" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title}>
      <div className="m-sheet-in">
        <div className="m-sheet-head">
          <span className="m-grip" aria-hidden />
          {title && <h2>{title}</h2>}
          <button className="m-icon" onClick={onClose} aria-label={t("Close")}><Icon name="x" width={20} height={20} /></button>
        </div>
        <div className="m-sheet-body">{open && children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

/** Progress ring (weekly goal, challenge). */
export function Ring({ value, goal, size = 64, stroke = 7, children }: { value: number; goal: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <span className="m-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hair)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={f >= 1 ? "var(--plate-green)" : "var(--brand)"} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="m-ring-in">{children}</span>
    </span>
  );
}

export function Bar({ value, goal }: { value: number; goal: number }) {
  const f = goal > 0 ? Math.min(1, value / goal) : 0;
  return <span className="m-bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={value}><i style={{ width: `${f * 100}%`, background: f >= 1 ? "var(--plate-green)" : undefined }} /></span>;
}

export function SubHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="m-subhead">
      <button className="m-icon" onClick={onBack} aria-label={t("Back")}><Icon name="back" width={22} height={22} style={getLang() === "ar" ? { transform: "scaleX(-1)" } : undefined} /></button>
      <h1>{title}</h1>
      {right ?? <span style={{ width: 40 }} />}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="m-section">
      <div className="m-section-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export const minutes = (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} h` : n > 60 ? `${Math.floor(n / 60)} h ${n % 60}` : `${n} min`);

/** "Today 18:00", "Tomorrow 07:30", "Thu 12 Nov · 18:00" */
export function when(iso: string) {
  const d = new Date(iso);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  const label = diff === 0 ? t("Today") : diff === 1 ? t("Tomorrow") : fmtDate(iso, { weekday: "short", day: "numeric", month: "short" });
  return `${label} · ${fmtTime(iso)}`;
}

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? t("Good evening") : h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
}

export function Thumb({ src, icon = "bag", alt = "" }: { src?: string | null; icon?: string; alt?: string }) {
  return src ? <img className="m-thumb" src={src} alt={alt} loading="lazy" /> : <span className="m-thumb empty"><Icon name={icon} width={26} height={26} /></span>;
}
