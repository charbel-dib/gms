import { t } from "../shared/i18n.ts";
/** The signed-in staff member's own account: password, two-step sign-in. */
import React, { useState } from "react";
import { post } from "../shared/api.ts";
import { Field, Modal, toast, useAction } from "../shared/ui.tsx";
import { qrSvg } from "../shared/qr.ts";
import { useApp } from "./app.tsx";
import { MyTelegram } from "./telegram.tsx";

function PasswordForm({ onDone, submitLabel = "Change password" }: { onDone: () => void; submitLabel?: string }) {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [err, setErr] = useState("");
  const { busy, run } = useAction();
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setErr("");
      if (f.next.length < 8) return setErr("Use at least 8 characters.");
      if (f.next !== f.again) return setErr("The two new passwords are different.");
      const r = await run(() => post("/api/auth/password", { current: f.current, next: f.next }), "Password changed");
      if (r) onDone();
    }}>
      <Field label={t("Current password")}><input className="input" type="password" autoComplete="current-password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label={t("New password")} hint={t("At least 8 characters. A short sentence is easy to remember and hard to guess.")}>
        <input className="input" type="password" autoComplete="new-password" required value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
      </Field>
      <Field label={t("New password again")}><input className="input" type="password" autoComplete="new-password" required value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field>
      {err && <p role="alert" style={{ color: "var(--plate-red)", margin: 0 }}>{err}</p>}
      <div><button className="btn primary" disabled={busy}>{busy ? t("Saving…") : submitLabel}</button></div>
    </form>
  );
}

/** Shown instead of the app while the password is one someone else chose (new account, reset). */
export function ForcePasswordChange({ name, onDone }: { name: string; onDone: () => void }) {
  return (
    <div className="auth">
      <div className="auth-form" style={{ gridColumn: "1 / -1" }}>
        <div style={{ maxWidth: 380, width: "100%" }} className="stack">
          <h2 style={{ margin: 0 }}>{t("Choose your password")}</h2>
          <p className="ink-2" style={{ margin: 0 }}>{t("Hi")}{" "}{name.split(" ")[0]}{t(", you signed in with a temporary password. Pick your own to continue: nobody else will know it.")}</p>
          <PasswordForm onDone={onDone} submitLabel="Save and continue" />
          <button className="btn ghost" onClick={async () => { await post("/api/auth/logout"); location.href = "/login"; }}>{t("Sign out")}</button>
        </div>
      </div>
    </div>
  );
}

function TwoStep() {
  const { me, reloadMe } = useApp();
  const on = !!me.user.totp_enabled;
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const { busy, run } = useAction();
  if (on) {
    return (
      <div className="stack">
        <p style={{ margin: 0 }}><span className="plate" data-s="ok" /> {t("On. Signing in asks for the 6-digit code from your authenticator app.")}</p>
        <Field label={t("Your password, to turn it off")}><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <div><button className="btn danger" disabled={busy || !pw} onClick={async () => { if (await run(() => post("/api/auth/2fa/disable", { password: pw }), "Two-step sign-in is off")) { setPw(""); reloadMe(); } }}>{t("Turn off")}</button></div>
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="stack">
        <p className="ink-2" style={{ margin: 0 }}>{t("Off. With it on, a stolen password is not enough: signing in also needs a code from your phone (Google Authenticator, Microsoft Authenticator, 1Password…).")}</p>
        <div><button className="btn" disabled={busy} onClick={async () => { const r = await run(() => post("/api/auth/2fa/setup")); if (r) setSetup(r); }}>{t("Set up two-step sign-in")}</button></div>
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      if (await run(() => post("/api/auth/2fa/enable", { code }), "Two-step sign-in is on")) { setSetup(null); setCode(""); reloadMe(); }
    }}>
      <p style={{ margin: 0 }}>{t("1. Scan this code with your authenticator app.")}</p>
      <div style={{ width: 180 }} dangerouslySetInnerHTML={{ __html: qrSvg(setup.uri) }} />
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>{t("Can't scan? Type this key in the app:")}{" "}<code style={{ userSelect: "all", wordBreak: "break-all" }}>{setup.secret}</code></p>
      <Field label={t("2. Type the 6-digit code it shows")}><input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} style={{ width: 140 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
      <div><button className="btn primary" disabled={busy || code.length !== 6}>{t("Turn on")}</button></div>
    </form>
  );
}

export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useApp();
  return (
    <Modal title={t("Your account")} open={open} onClose={onClose}>
      <p className="ink-2" style={{ marginTop: 0 }}>{me.user.name} · {me.user.email}</p>
      <section className="stack">
        <h3 style={{ margin: 0 }}>{t("Password")}</h3>
        <PasswordForm onDone={() => { toast(t("Other devices were signed out")); onClose(); }} />
      </section>
      <hr style={{ border: 0, borderTop: "1px solid var(--line-2)", margin: "20px 0" }} />
      <section className="stack">
        <h3 style={{ margin: 0 }}>{t("Two-step sign-in")}</h3>
        <TwoStep />
      </section>
      {(me.user.role === "owner" || me.user.role === "manager" || me.user.role === "superadmin") && (
        <>
          <hr style={{ border: 0, borderTop: "1px solid var(--line-2)", margin: "20px 0" }} />
          <section className="stack">
            <h3 style={{ margin: 0 }}>{t("Telegram")}</h3>
            <MyTelegram purpose={me.user.role === "superadmin" ? "Get new free-month requests the moment they arrive, and the platform's week every Monday." : t("Get your gym's week every Monday morning, and ask about your numbers any time.")} />
          </section>
        </>
      )}
    </Modal>
  );
}
