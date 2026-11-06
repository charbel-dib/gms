/**
 * API reference: every server route, generated from the code at build time (GET /api/docs.json).
 * Owners and platform admins can read it, download the OpenAPI file and try calls in their own session.
 */
import React, { useContext, useMemo, useState } from "react";
import { get, getGymOverride } from "../../shared/api.ts";
import { Icon, Loader, useAsync, useDebounced } from "../../shared/ui.tsx";
import { t } from "../../shared/i18n.ts";
import { AppCtx, navigate } from "../app.tsx";

type Op = {
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  parameters: { name: string; in: string; required?: boolean; description?: string; schema?: any }[];
  body?: any;
  auth: { kind: string; roles?: string[] };
  source: string;
  responseType: string;
};

const ACCESS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "staff", label: "Staff" },
  { value: "member", label: "Member app" },
  { value: "public", label: "Public" },
  { value: "superadmin", label: "Platform" },
];

function flatten(spec: any): Op[] {
  const ops: Op[] = [];
  for (const [path, methods] of Object.entries<any>(spec.paths)) {
    for (const [m, o] of Object.entries<any>(methods)) {
      const ok = o.responses?.["200"]?.content ?? {};
      ops.push({
        method: m.toUpperCase(),
        path,
        tag: o.tags?.[0] ?? "Other",
        summary: o.summary,
        description: o.description ?? "",
        parameters: o.parameters ?? [],
        body: o.requestBody?.content?.["application/json"]?.schema,
        auth: o["x-auth"] ?? { kind: "public" },
        source: o["x-source"] ?? "",
        responseType: Object.keys(ok)[0] ?? "application/json",
      });
    }
  }
  return ops;
}

/** Inline `code` and paragraphs: all the formatting the generated descriptions use. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i}>{para.split(/(`[^`]+`)/).map((bit, j) => (bit.startsWith("`") ? <code key={j}>{bit.slice(1, -1)}</code> : bit))}</p>
      ))}
    </>
  );
}

function typeLabel(s: any): string {
  if (!s) return "any";
  if (s.anyOf) return s.anyOf.map(typeLabel).join(" | ");
  if (s.const !== undefined) return JSON.stringify(s.const);
  const types = (Array.isArray(s.type) ? s.type : [s.type]).filter(Boolean);
  let base = types.filter((x: string) => x !== "null").join(" | ") || (s.enum ? "enum" : "any");
  if (base === "array") base = `${typeLabel(s.items)}[]`;
  if (s.format) base += ` (${s.format})`;
  return types.includes("null") ? `${base} | null` : base;
}

function rules(s: any): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.enum) out.push(`one of: ${s.enum.join(", ")}`);
  if (s.minLength !== undefined && s.minLength === s.maxLength) out.push(`exactly ${s.minLength} characters`);
  else {
    if (s.minLength) out.push(`min ${s.minLength} characters`);
    if (s.maxLength !== undefined) out.push(`max ${s.maxLength} characters`);
  }
  if (s.minimum !== undefined) out.push(`≥ ${s.minimum}`);
  if (s.exclusiveMinimum !== undefined) out.push(`> ${s.exclusiveMinimum}`);
  if (s.maximum !== undefined) out.push(`≤ ${s.maximum}`);
  if (s.minItems) out.push(`at least ${s.minItems} item(s)`);
  if (s.maxItems) out.push(`at most ${s.maxItems} item(s)`);
  if (s.pattern) out.push(`pattern ${s.pattern}`);
  if (s["x-coerce"]) out.push("numbers sent as text are accepted");
  return out;
}

/** Body fields as rows, nested objects and arrays of objects shown with dotted names. */
/** `required` is relative to the parent: a field of an optional object is required when that object is sent. */
function fields(schema: any, prefix = ""): { name: string; s: any; required: boolean }[] {
  const obj = schema?.anyOf?.find((x: any) => x.type === "object" || (Array.isArray(x.type) && x.type.includes("object"))) ?? schema;
  if (!obj?.properties) return [];
  const rows: { name: string; s: any; required: boolean }[] = [];
  for (const [k, v] of Object.entries<any>(obj.properties)) {
    const name = prefix + k;
    const required = (obj.required ?? []).includes(k);
    rows.push({ name, s: v, required });
    const isObj = v.properties || v.anyOf?.some((x: any) => x.properties);
    if (isObj) rows.push(...fields(v, name + "."));
    else if (v.items?.properties) rows.push(...fields(v.items, name + "[]."));
  }
  return rows;
}

function example(s: any, depth = 0): any {
  if (!s || depth > 5) return null;
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.anyOf) return example(s.anyOf.find((x: any) => x.type !== "null") ?? s.anyOf[0], depth + 1);
  if (s.enum) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type.find((x: string) => x !== "null") : s.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<any>(s.properties ?? {})) {
        if ((s.required ?? []).includes(k) || v.default !== undefined) out[k] = example(v, depth + 1);
      }
      return out;
    }
    case "array": return s.items ? [example(s.items, depth + 1)] : [];
    case "integer":
    case "number": return s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 1);
    case "boolean": return false;
    case "string":
      if (s.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (s.format === "date") return new Date().toISOString().slice(0, 10);
      if (s.format === "date-time") return new Date().toISOString();
      if (s.format === "email") return "name@example.com";
      return "text";
    default: return null;
  }
}

function Access({ a }: { a: Op["auth"] }) {
  if (a.kind === "public") return <span className="api-role open">public</span>;
  if (a.kind === "member") return <span className="api-role">member</span>;
  if (a.kind === "superadmin") return <span className="api-role">platform admin</span>;
  return <>{(a.roles ?? []).map((r) => <span key={r} className="api-role">{r}</span>)}</>;
}

function TryIt({ op }: { op: Op }) {
  const pathParams = op.parameters.filter((p) => p.in === "path");
  const queryParams = op.parameters.filter((p) => p.in === "query");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [body, setBody] = useState(() => (op.body ? JSON.stringify(example(op.body), null, 2) : ""));
  const [confirm, setConfirm] = useState(false);
  const [res, setRes] = useState<{ status: number; ms: number; type: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const writes = op.method !== "GET";
  const url = useMemo(() => {
    let p = op.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vals["p:" + k] ?? "") || `{${k}}`);
    const qs = new URLSearchParams();
    for (const q of queryParams) if (vals["q:" + q.name]) qs.set(q.name, vals["q:" + q.name]);
    const s = qs.toString();
    return s ? `${p}?${s}` : p;
  }, [vals, op.path]);
  const missing = pathParams.some((p) => !vals["p:" + p.name]);
  let bodyError = "";
  if (op.body) {
    try { JSON.parse(body || "{}"); } catch { bodyError = "The body is not valid JSON."; }
  }

  async function send() {
    setBusy(true);
    const started = performance.now();
    try {
      const gym = getGymOverride();
      const r = await fetch(url, {
        method: op.method,
        credentials: "same-origin",
        headers: { ...(op.body ? { "Content-Type": "application/json" } : {}), ...(gym ? { "X-Gym-Id": gym } : {}) },
        body: op.body ? body || "{}" : undefined,
      });
      const type = r.headers.get("content-type") ?? "";
      let text: string;
      if (/json/.test(type)) {
        const raw = await r.text();
        try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch { text = raw; }
      } else if (/^image\//.test(type)) text = `(${type} image, ${(await r.blob()).size} bytes)`;
      else text = await r.text();
      setRes({ status: r.status, ms: Math.round(performance.now() - started), type, text: text.length > 40000 ? text.slice(0, 40000) + "\n… (cut)" : text });
    } catch (e: any) {
      setRes({ status: 0, ms: 0, type: "", text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="api-try">
      <h4>Try it</h4>
      {(pathParams.length > 0 || queryParams.length > 0) && (
        <div className="api-try-params">
          {[...pathParams.map((p) => ({ p, key: "p:" + p.name })), ...queryParams.map((p) => ({ p, key: "q:" + p.name }))].map(({ p, key }) => (
            <label key={key}>
              <span><code>{p.name}</code>{p.in === "path" ? " *" : ""}</span>
              <input className="input" value={vals[key] ?? ""} placeholder={p.schema?.format === "date" ? "YYYY-MM-DD" : p.schema?.format === "uuid" ? "uuid" : p.in === "query" ? "optional" : ""}
                onChange={(e) => setVals({ ...vals, [key]: e.target.value })} />
            </label>
          ))}
        </div>
      )}
      {op.body && (
        <label className="api-try-body">
          <span>Body (JSON)</span>
          <textarea className="input mono" rows={Math.min(16, body.split("\n").length + 1)} value={body} spellCheck={false} onChange={(e) => setBody(e.target.value)} />
        </label>
      )}
      <div className="api-try-url"><b>{op.method}</b> <code>{url}</code></div>
      {writes && (
        <label className="api-try-confirm">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          This call changes real data in the gym that is open now.
        </label>
      )}
      <div className="row">
        <button className="btn primary" disabled={busy || missing || !!bodyError || (writes && !confirm)} onClick={send}>
          <Icon name="send" />{busy ? "Sending…" : "Send"}
        </button>
        {missing && <small className="muted">Fill the path parameters first.</small>}
        {bodyError && <small style={{ color: "var(--plate-red)" }}>{bodyError}</small>}
      </div>
      {res && (
        <div className="api-try-res">
          <div className="api-try-status">
            <span className="plate" data-s={res.status >= 200 && res.status < 300 ? "ok" : res.status >= 500 || res.status === 0 ? "denied" : "warn"} />
            <b>{res.status || "network error"}</b> <small className="muted">{res.ms} ms · {res.type || "no body"}</small>
          </div>
          <pre>{res.text || "(empty)"}</pre>
        </div>
      )}
    </div>
  );
}

function Detail({ op }: { op: Op }) {
  const params = op.parameters.filter((p) => p.in !== "header");
  const rows = fields(op.body);
  return (
    <div className="api-detail">
      {op.description && <div className="api-desc"><Prose text={op.description} /></div>}
      {params.length > 0 && (
        <>
          <h4>Parameters</h4>
          <table className="data api-table">
            <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Notes</th></tr></thead>
            <tbody>{params.map((p) => (
              <tr key={p.in + p.name}>
                <td><code>{p.name}</code>{p.required && <span className="api-req">required</span>}</td>
                <td>{p.in}</td>
                <td className="mono">{typeLabel(p.schema)}</td>
                <td className="ink-2">{p.description ?? (p.schema?.format === "uuid" ? "Id of the record" : p.schema?.format === "date" ? "YYYY-MM-DD" : p.in === "query" ? "Optional" : "")}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
      {op.body && (
        <>
          <h4>Request body <small className="muted">application/json</small></h4>
          {rows.length ? (
            <table className="data api-table">
              <thead><tr><th>Field</th><th>Type</th><th>Rules</th><th>Default</th></tr></thead>
              <tbody>{rows.map((f) => (
                <tr key={f.name}>
                  <td><code>{f.name}</code>{f.required && <span className="api-req">required</span>}</td>
                  <td className="mono">{typeLabel(f.s)}</td>
                  <td className="ink-2">{rules(f.s).join(" · ")}</td>
                  <td className="mono">{f.s.default !== undefined ? JSON.stringify(f.s.default) : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : (
            <pre className="api-schema">{JSON.stringify(op.body, null, 2)}</pre>
          )}
        </>
      )}
      <h4>Response</h4>
      <p className="ink-2">
        {op.responseType === "application/json" ? <>JSON. Errors: <code>{"{ \"error\": \"code\", \"message\": \"…\" }"}</code> with status 400 (invalid input), 401 (not signed in), 403 (role not allowed), 404 or 409.</> : <>{op.responseType}</>}
      </p>
      <TryIt op={op} />
      {op.source && <p className="api-source">Defined in <code>{op.source}</code></p>}
    </div>
  );
}

export function DevelopersPage() {
  const ctx = useContext(AppCtx);
  const platformOnly = ctx?.me.user.role === "superadmin" && !ctx.me.gym;
  const state = useAsync(() => get("/api/docs.json"), []);
  const [q, setQ] = useState("");
  const [access, setAccess] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q.trim().toLowerCase(), 120);

  function download(spec: unknown) {
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gms-openapi.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="page">
      <Loader state={state}>
        {(spec: any) => {
          const ops = flatten(spec);
          const shown = ops.filter((o) =>
            (access === "all" || o.auth.kind === access) &&
            (!dq || `${o.method} ${o.path} ${o.summary} ${o.tag}`.toLowerCase().includes(dq)),
          );
          const tags: string[] = spec.tags.map((x: any) => x.name).filter((n: string) => shown.some((o) => o.tag === n));
          return (
            <>
              <div className="page-head">
                <div>
                  <h1>{t("API reference")}</h1>
                  <p>Every route of the GMS server, generated from the code at each build · version {spec.info.version} · {ops.length} routes.</p>
                </div>
                <div className="row">
                  {platformOnly && <button className="btn" onClick={() => navigate("/")}><Icon name="back" />Platform</button>}
                  <button className="btn" onClick={() => download(spec)}><Icon name="download" />OpenAPI file</button>
                </div>
              </div>

              <div className="panel api-intro">
                <div className="body"><Prose text={spec.info.description} /><p className="ink-2">The OpenAPI file opens in Postman, Insomnia or Swagger Editor.</p></div>
              </div>

              <div className="api-filters">
                <label className="api-search">
                  <Icon name="search" width={18} height={18} />
                  <input className="input" placeholder="Search a route: members, receipt, POST /api/shop…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search routes" />
                </label>
                <div className="row" role="group" aria-label="Who can call it">
                  {ACCESS.map((a) => (
                    <button key={a.value} className={"chip" + (access === a.value ? " on" : "")} aria-pressed={access === a.value} onClick={() => setAccess(a.value)}>
                      {a.label} <span className="api-count">{a.value === "all" ? ops.length : ops.filter((o) => o.auth.kind === a.value).length}</span>
                    </button>
                  ))}
                </div>
              </div>

              {!shown.length && <div className="empty"><b>No route matches “{q}”.</b></div>}
              {tags.map((tag) => {
                const desc = spec.tags.find((x: any) => x.name === tag)?.description;
                return (
                  <section key={tag} className="panel api-group">
                    <header><div><h2>{tag}</h2>{desc && <small className="ink-2">{desc}</small>}</div><span className="muted">{shown.filter((o) => o.tag === tag).length}</span></header>
                    <ul className="api-list">
                      {shown.filter((o) => o.tag === tag).map((o) => {
                        const id = `${o.method} ${o.path}`;
                        const isOpen = open === id;
                        return (
                          <li key={id} className={isOpen ? "open" : ""}>
                            <button className="api-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                              <span className="api-method" data-m={o.method}>{o.method}</span>
                              <code className="api-path">{o.path}</code>
                              <span className="api-summary">{o.summary}</span>
                              <span className="api-roles"><Access a={o.auth} /></span>
                            </button>
                            {isOpen && <Detail op={o} />}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </>
          );
        }}
      </Loader>
    </div>
  );
}
