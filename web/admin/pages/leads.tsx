import React, { useState } from "react";
import { get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, useAction, useAsync } from "../../shared/ui.tsx";
import { fmtDate, t } from "../../shared/i18n.ts";
import { navigate } from "../app.tsx";

const STAGES = ["new", "contacted", "trial", "converted", "lost"] as const;
const LABEL: Record<string, string> = { new: "New", contacted: "Contacted", trial: "Trial visit", converted: "Joined", lost: "Lost" };

export function LeadsPage() {
  const state = useAsync(() => get("/api/leads"), []);
  const [edit, setEdit] = useState<any>(null);
  const [stage, setStage] = useState<string>("open");
  const { busy, run } = useAction();
  const save = async () => {
    const body = { name: edit.name, phone: edit.phone || null, source: edit.source || null, status: edit.status, interest: edit.interest || null, notes: edit.notes || null, follow_up_on: edit.follow_up_on || null };
    const r = await run(() => (edit.id ? put(`/api/leads/${edit.id}`, body) : post("/api/leads", body)), t("Save"));
    if (r) { setEdit(null); state.reload(); }
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Leads")}</h1><p>People who asked about the gym on Instagram, by phone or at the door. Follow up until they join.</p></div>
        <button className="btn primary" onClick={() => setEdit({ status: "new", source: "instagram" })}><Icon name="plus" />Add a lead</button>
      </div>
      <Segmented label="Stage" value={stage} onChange={setStage} options={[{ value: "open", label: "Open" }, ...STAGES.map((s) => ({ value: s, label: LABEL[s] }))]} />
      <Loader state={state}>
        {(list: any[]) => {
          const rows = list.filter((l) => (stage === "open" ? !["converted", "lost"].includes(l.status) : l.status === stage));
          return rows.length ? (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>{t("Name")}</th><th>Interest</th><th>Stage</th><th>Follow up</th><th /></tr></thead>
              <tbody>{rows.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => setEdit({ ...l })}>
                  <td><span className="who"><b>{l.name}</b><small>{l.phone ?? "—"} · {l.source ?? ""}</small></span></td>
                  <td>{l.interest ?? "—"}</td>
                  <td><span className="tag">{LABEL[l.status]}</span></td>
                  <td style={{ color: l.follow_up_on && l.follow_up_on <= today && !["converted", "lost"].includes(l.status) ? "var(--plate-red)" : undefined }}>{l.follow_up_on ? fmtDate(l.follow_up_on) : "—"}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    {l.phone && <a className="btn small" href={`https://wa.me/${l.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" /></a>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No lead in this stage." />;
        }}
      </Loader>
      {edit && (
        <Modal title={edit.id ? edit.name : "Add a lead"} open onClose={() => setEdit(null)}
          footer={<>
            {edit.id && edit.status !== "converted" && <button className="btn" onClick={() => navigate(`/members?new=1`)}>Make them a member</button>}
            <button className="btn primary" disabled={busy || !edit.name} onClick={save}>{t("Save")}</button>
          </>}>
          <div className="grid-2">
            <Field label={t("Name")}><input className="input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t("Phone")}><input className="input" value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Source"><select className="input" value={edit.source ?? ""} onChange={(e) => setEdit({ ...edit, source: e.target.value })}>{["instagram", "tiktok", "walk-in", "referral", "google", "other"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Interested in"><input className="input" value={edit.interest ?? ""} onChange={(e) => setEdit({ ...edit, interest: e.target.value })} placeholder="Weight loss, classes, PT…" /></Field>
            <Field label="Stage"><select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STAGES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select></Field>
            <Field label="Follow up on"><input className="input" type="date" value={edit.follow_up_on ?? ""} onChange={(e) => setEdit({ ...edit, follow_up_on: e.target.value })} /></Field>
          </div>
          <Field label={t("Notes")}><textarea className="input" value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
