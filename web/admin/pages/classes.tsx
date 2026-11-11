import React, { useMemo, useState } from "react";
import { del, get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Tabs, toast, useAction, useAsync, useDebounced } from "../../shared/ui.tsx";
import { WEEKDAYS, fmtDate, fmtTime, t } from "../../shared/i18n.ts";
import { can, useApp } from "../app.tsx";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function ClassesPage() {
  const { me } = useApp();
  const [tab, setTab] = useState<"week" | "schedule" | "types">("week");
  const [offset, setOffset] = useState(0);
  const start = useMemo(() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset * 7); return d; }, [offset]);
  const end = useMemo(() => { const d = new Date(start); d.setDate(d.getDate() + 6); return d; }, [start]);
  const sessions = useAsync(() => get(`/api/classes/sessions?from=${iso(start)}&to=${iso(end)}`), [offset, tab]);
  const [open, setOpen] = useState<any>(null);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Classes")}</h1><p>{t("Members book from their app; reception can book for them here.")}</p></div>
        {tab === "week" && (
          <div className="row">
            <button className="btn" onClick={() => setOffset((o) => o - 1)} aria-label={t("Previous week")}><Icon name="back" /></button>
            <span className="ink-2">{fmtDate(start)} – {fmtDate(end)}</span>
            <button className="btn" onClick={() => setOffset((o) => o + 1)} aria-label={t("Next week")}><Icon name="back" style={{ transform: "scaleX(-1)" }} /></button>
            {offset !== 0 && <button className="btn ghost" onClick={() => setOffset(0)}>{t("This week")}</button>}
          </div>
        )}
      </div>
      {can(me, "owner", "manager") && <Tabs value={tab} onChange={setTab} tabs={[{ value: "week", label: t("Week") }, { value: "schedule", label: t("Weekly schedule") }, { value: "types", label: t("Class types") }]} />}
      {tab === "week" && (
        <Loader state={sessions}>
          {(list: any[]) => (
            <div className="week">
              {days.map((d) => {
                const key = iso(d);
                const uniq = list.filter((s) => new Date(s.starts_at).toDateString() === d.toDateString());
                return (
                  <div key={key} className="day-col">
                    <h3 className={d.toDateString() === new Date().toDateString() ? "today" : ""}>{t(WEEKDAYS[d.getDay()])} {d.getDate()}</h3>
                    {uniq.map((s) => (
                      <button key={s.id} className={`session ${s.cancelled ? "cancelled" : ""}`} style={{ ["--c" as any]: s.color }} onClick={() => setOpen(s)}>
                        <b>{s.class_name}</b>
                        <span className="muted">{fmtTime(s.starts_at)}{s.coach_name ? ` · ${s.coach_name}` : ""}</span>
                        <span>{s.booked}/{s.capacity}{s.waitlist ? ` +${s.waitlist} waiting` : ""}</span>
                        <span className="fill"><span style={{ width: `${Math.min(100, (s.booked / s.capacity) * 100)}%` }} /></span>
                      </button>
                    ))}
                    {!uniq.length && <span className="muted" style={{ fontSize: "0.8rem", padding: 4 }}>—</span>}
                  </div>
                );
              })}
            </div>
          )}
        </Loader>
      )}
      {tab === "schedule" && <ScheduleEditor />}
      {tab === "types" && <TypesEditor />}
      {open && <SessionModal s={open} onClose={() => { setOpen(null); sessions.reload(); }} />}
    </div>
  );
}

function SessionModal({ s, onClose }: { s: any; onClose: () => void }) {
  const { me } = useApp();
  const bookings = useAsync(() => get(`/api/classes/sessions/${s.id}/bookings`), [s.id]);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const found = useAsync(() => (dq.length >= 2 ? get(`/api/members?q=${encodeURIComponent(dq)}&limit=5`) : Promise.resolve({ rows: [] })), [dq]);
  const { run } = useAction();
  const setStatus = async (id: string, status: string) => { await run(() => put(`/api/bookings/${id}`, { status })); bookings.reload(); };
  return (
    <Modal title={`${s.class_name} · ${fmtDate(s.starts_at, { weekday: "long", day: "numeric", month: "short" })} ${fmtTime(s.starts_at)}`} open onClose={onClose} wide
      footer={can(me, "owner", "manager") && !s.cancelled ? <button className="btn danger" onClick={async () => {
        if (!confirm(t("Cancel this class? Booked members get a WhatsApp."))) return;
        await run(() => put(`/api/classes/sessions/${s.id}`, { cancelled: true }), "Class cancelled, members notified");
        onClose();
      }}>{t("Cancel this class")}</button> : undefined}>
      <p className="ink-2">{s.coach_name ?? t("No coach")} · {s.booked}/{s.capacity} booked{s.room ? ` · ${s.room}` : ""}</p>
      {can(me, "owner", "manager", "reception") && !s.cancelled && (
        <div className="stack-s">
          <input className="input" placeholder={t("Book a member: name, phone or number")} value={q} onChange={(e) => setQ(e.target.value)} />
          {found.data?.rows?.map((m: any) => (
            <div key={m.id} className="spread"><span>{m.first_name} {m.last_name} <small className="muted">#{m.code}</small></span>
              <button className="btn small" onClick={async () => { const r = await run(() => post(`/api/classes/sessions/${s.id}/bookings`, { member_id: m.id })); if (r) { toast(r.status === "booked" ? "Booked" : "Added to the waitlist"); setQ(""); bookings.reload(); } }}>{t("Book")}</button></div>
          ))}
        </div>
      )}
      <Loader state={bookings}>
        {(list: any[]) => list.length ? (
          <div className="table-wrap"><table className="data"><tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td><span className="who"><b>{b.first_name} {b.last_name}</b><small>#{b.code}</small></span></td>
                <td><span className="tag">{b.status.replace("_", " ")}</span></td>
                <td className="r">
                  <button className="btn small" onClick={() => setStatus(b.id, "attended")} aria-pressed={b.status === "attended"}><Icon name="check" />{t("Came")}</button>{" "}
                  <button className="btn small" onClick={() => setStatus(b.id, "no_show")}>{t("No-show")}</button>{" "}
                  <button className="btn small ghost" onClick={() => setStatus(b.id, "cancelled")}>{t("Cancel")}</button>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <Empty title={t("Nobody booked yet.")} />}
      </Loader>
    </Modal>
  );
}

function ScheduleEditor() {
  const sched = useAsync(() => get("/api/classes/schedules"), []);
  const types = useAsync(() => get("/api/classes/types"), []);
  const staff = useAsync(() => get("/api/staff"), []);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction();
  return (
    <div className="stack">
      <div className="spread"><p className="ink-2">{t("Each line repeats every week. Changes apply to future classes that nobody booked yet.")}</p><button className="btn primary" onClick={() => setEdit({ weekday: 1, start_time: "18:00", duration_min: 60, capacity: 15, active: true })}><Icon name="plus" />{t("Add a weekly class")}</button></div>
      <Loader state={sched}>
        {(list: any[]) => (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t("Day")}</th><th>{t("Time")}</th><th>{t("Class")}</th><th>{t("Coach")}</th><th>{t("Capacity")}</th><th /></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id} style={!s.active ? { opacity: 0.45 } : undefined}>
                <td>{t(WEEKDAYS[s.weekday])}</td><td>{s.start_time}</td>
                <td><span className="class-chip" style={{ background: s.color, display: "inline-block", height: 12, marginInlineEnd: 8 }} />{s.class_name}</td>
                <td>{s.coach_name ?? <span className="muted">—</span>}</td><td>{s.capacity}</td>
                <td className="r"><button className="btn small" onClick={() => setEdit(s)}>{t("Edit")}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Loader>
      {edit && (
        <Modal title={edit.id ? t("Edit weekly class") : t("Add a weekly class")} open onClose={() => setEdit(null)}
          footer={<>
            {edit.id && <button className="btn danger" onClick={async () => { await run(() => del(`/api/classes/schedules/${edit.id}`), "Removed from the schedule"); setEdit(null); sched.reload(); }}>{t("Remove")}</button>}
            <button className="btn primary" disabled={busy || !edit.class_type_id} onClick={async () => {
              const body = { class_type_id: edit.class_type_id, coach_id: edit.coach_id || null, weekday: Number(edit.weekday), start_time: edit.start_time, duration_min: Number(edit.duration_min), capacity: Number(edit.capacity), room: edit.room || null, active: edit.active };
              const r = await run(() => (edit.id ? put(`/api/classes/schedules/${edit.id}`, body) : post("/api/classes/schedules", body)), t("Save"));
              if (r) { setEdit(null); sched.reload(); }
            }}>{t("Save")}</button></>}>
          <Field label={t("Class")}><select className="input" value={edit.class_type_id ?? ""} onChange={(e) => {
            const ct = types.data?.find((x: any) => x.id === e.target.value);
            setEdit({ ...edit, class_type_id: e.target.value, duration_min: ct?.duration_min ?? edit.duration_min, capacity: ct?.default_capacity ?? edit.capacity });
          }}><option value="">{t("Choose…")}</option>{types.data?.filter((x: any) => x.active).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <div className="grid-3">
            <Field label={t("Day")}><select className="input" value={edit.weekday} onChange={(e) => setEdit({ ...edit, weekday: e.target.value })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{t(w)}</option>)}</select></Field>
            <Field label={t("Time")}><input className="input" type="time" value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></Field>
            <Field label={t("Minutes")}><input className="input" type="number" value={edit.duration_min} onChange={(e) => setEdit({ ...edit, duration_min: e.target.value })} /></Field>
          </div>
          <div className="grid-3">
            <Field label={t("Capacity")}><input className="input" type="number" value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} /></Field>
            <Field label={t("Coach")}><select className="input" value={edit.coach_id ?? ""} onChange={(e) => setEdit({ ...edit, coach_id: e.target.value })}><option value="">—</option>{staff.data?.filter((u: any) => u.role !== "reception").map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label={t("Room")}><input className="input" value={edit.room ?? ""} onChange={(e) => setEdit({ ...edit, room: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TypesEditor() {
  const types = useAsync(() => get("/api/classes/types"), []);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction();
  return (
    <div className="stack">
      <div className="spread"><p className="ink-2">{t("The kinds of classes your gym offers.")}</p><button className="btn primary" onClick={() => setEdit({ color: "#4b5fc9", default_capacity: 15, duration_min: 60, women_only: false, active: true })}><Icon name="plus" />{t("New class type")}</button></div>
      <Loader state={types}>
        {(list: any[]) => (
          <div className="table-wrap"><table className="data"><tbody>{list.map((c) => (
            <tr key={c.id} style={!c.active ? { opacity: 0.45 } : undefined}>
              <td><span className="class-chip" style={{ background: c.color, display: "inline-block", height: 14, marginInlineEnd: 10 }} /><b>{c.name}</b> {c.name_ar && <span className="muted">{c.name_ar}</span>}</td>
              <td>{c.duration_min} {t("min ·")}{" "}{c.default_capacity} places{c.women_only ? t(" · women only") : ""}</td>
              <td className="r"><button className="btn small" onClick={() => setEdit(c)}>{t("Edit")}</button></td>
            </tr>
          ))}</tbody></table></div>
        )}
      </Loader>
      {edit && (
        <Modal title={edit.id ? t("Edit class type") : t("New class type")} open onClose={() => setEdit(null)}
          footer={<button className="btn primary" disabled={busy || !edit.name} onClick={async () => {
            const body = { name: edit.name, name_ar: edit.name_ar || null, color: edit.color, description: edit.description || null, default_capacity: Number(edit.default_capacity), duration_min: Number(edit.duration_min), women_only: !!edit.women_only, active: !!edit.active };
            const r = await run(() => (edit.id ? put(`/api/classes/types/${edit.id}`, body) : post("/api/classes/types", body)), t("Save"));
            if (r) { setEdit(null); types.reload(); }
          }}>{t("Save")}</button>}>
          <div className="grid-2">
            <Field label={t("Name")}><input className="input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t("Name in Arabic")}><input className="input" dir="rtl" value={edit.name_ar ?? ""} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></Field>
            <Field label={t("Default capacity")}><input className="input" type="number" value={edit.default_capacity} onChange={(e) => setEdit({ ...edit, default_capacity: e.target.value })} /></Field>
            <Field label={t("Minutes")}><input className="input" type="number" value={edit.duration_min} onChange={(e) => setEdit({ ...edit, duration_min: e.target.value })} /></Field>
            <Field label={t("Colour")}><input className="input" type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={!!edit.women_only} onChange={(e) => setEdit({ ...edit, women_only: e.target.checked })} /> {t("Women only")}</label>
          <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {t("Active")}</label>
        </Modal>
      )}
    </div>
  );
}
