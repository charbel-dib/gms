#!/usr/bin/env node
/**
 * GMS load test: invents the traffic of N gyms at their evening peak and raises it step by step.
 *
 *   node scripts/loadtest/run.mjs --base https://xxxx.cloudfront.net --kit gms-loadtest-kit.json
 *        [--steps 1,2,5,10,20] [--seconds 120] [--out loadtest-results]
 *
 * The kit comes from the Platform page (Load test card). It holds 24-hour tokens for the fake gyms only.
 *
 * Step "1" is a realistic evening peak for every gym in the kit (about 720 requests per gym per hour,
 * so ~10 requests per second for 50 gyms). Step "5" is five times that, and so on.
 * Traffic is "open": people keep arriving at the planned rate even if the server slows down,
 * so an overloaded server shows up as rising response times and errors, like in real life.
 * The test stops early when a step goes badly (more than 5% errors, or 95% of requests slower than 3 s).
 */
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const BASE = (args.base ?? "").replace(/\/$/, "");
if (!BASE || !args.kit) { console.error("usage: node run.mjs --base https://… --kit gms-loadtest-kit.json [--steps 1,2,5,10,20] [--seconds 120]"); process.exit(1); }
const kit = JSON.parse(fs.readFileSync(args.kit, "utf8"));
const STEPS = (args.steps ?? "1,2,5,10,20").split(",").map(Number);
const SECONDS = Number(args.seconds ?? 120);
const OUT = args.out ?? "loadtest-results";
const gyms = kit.gyms.filter((g) => g.desk && g.owner && g.members.length);
const N = gyms.length;

// ---- what one gym does in its busiest hour (actions per hour), and what each action calls ----
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ACTIONS = {
  // the desk types a few letters of a name, then checks the member in
  checkin: { perHour: 120, run: async (g) => {
    const m = pick(g.members);
    await call("desk: search", g.desk, "staff", "GET", `/api/members?limit=6&sort=name&q=${encodeURIComponent(m.name.slice(0, 3))}`);
    await call("desk: check-in", g.desk, "staff", "POST", "/api/checkin", { member_id: m.id });
  } },
  // the owner opens Today
  today: { perHour: 30, run: async (g) => {
    await Promise.all([
      call("owner: today", g.owner, "staff", "GET", "/api/dashboard"),
      call("owner: who owes", g.owner, "staff", "GET", "/api/members?balance=1&sort=balance&limit=4"),
      call("owner: at risk", g.owner, "staff", "GET", "/api/members?risk=1&sort=risk&limit=4"),
    ]);
  } },
  members: { perHour: 20, run: async (g) => {
    await call("desk: member list", g.desk, "staff", "GET", "/api/members?limit=50&sort=recent");
    await call("desk: member profile", g.desk, "staff", "GET", `/api/members/${pick(g.members).id}`);
  } },
  payment: { perHour: 12, run: async (g) => {
    await call("desk: payment", g.desk, "staff", "POST", "/api/payments", { member_id: pick(g.members).id, amount: 30, currency: "USD", method: "cash", note: "load test" });
  } },
  // every open desk screen polls the outbox once a minute and refreshes its offline copy every 10 minutes
  outbox: { perHour: 60, run: (g) => call("desk: outbox poll", g.desk, "staff", "GET", "/api/messages?status=outbox") },
  offline: { perHour: 6, run: (g) => call("desk: offline copy", g.desk, "staff", "GET", "/api/offline/members") },
  // members open the app
  app: { perHour: 100, run: async (g) => {
    const m = pick(g.members);
    await call("app: me", m.token, "member", "GET", "/api/m/me");
    await call("app: home", m.token, "member", "GET", "/api/m/home");
  } },
  classes: { perHour: 30, run: (g) => call("app: classes", pick(g.members).token, "member", "GET", "/api/m/classes") },
  progress: { perHour: 15, run: (g) => call("app: progress", pick(g.members).token, "member", "GET", "/api/m/progress") },
};

// ---- measurements ----
let stats;
const newStats = () => ({ byRoute: new Map(), started: performance.now(), inflightMax: 0, dropped: 0 });
let inflight = 0;
const MAX_INFLIGHT = 3000;
function record(label, ms, status) {
  let s = stats.byRoute.get(label);
  if (!s) stats.byRoute.set(label, (s = { n: 0, err: 0, codes: {}, lat: [] }));
  s.n++;
  s.lat.push(ms);
  if (!(status >= 200 && status < 400)) { s.err++; s.codes[status] = (s.codes[status] ?? 0) + 1; }
}
async function call(label, token, kind, method, url, body) {
  const t = performance.now();
  let status = 0;
  try {
    const res = await fetch(BASE + url, {
      method,
      headers: { cookie: `${kind === "staff" ? "gms_staff" : "gms_member"}=${token}`, ...(body ? { "content-type": "application/json" } : {}), "user-agent": "gms-loadtest" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    status = res.status;
    await res.arrayBuffer();
  } catch (e) {
    status = e?.name === "TimeoutError" ? "timeout" : "network";
  }
  record(label, performance.now() - t, status);
}
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

// ---- server health, read every 5 s with the kit's key ----
const health = [];
async function pollHealth(step) {
  try {
    const res = await fetch(BASE + "/api/loadtest/status", { headers: { "x-loadtest-key": kit.monitorKey }, signal: AbortSignal.timeout(8000) });
    if (res.ok) health.push({ step, at: Date.now(), ...(await res.json()) });
  } catch {}
}

// ---- one step ----
async function runStep(mult) {
  stats = newStats();
  const tick = 50;
  const perTick = Object.entries(ACTIONS).map(([k, a]) => [k, a, (a.perHour * N * mult) / 3600 / (1000 / tick)]);
  const acc = Object.fromEntries(perTick.map(([k]) => [k, Math.random()]));
  const end = Date.now() + SECONDS * 1000;
  const hp = setInterval(() => pollHealth(mult), 5000);
  const running = new Set();
  process.stdout.write(`step x${mult}: ~${Math.round(perTick.reduce((s, [, a, r]) => s + r, 0) * (1000 / tick))} actions/s for ${SECONDS}s `);
  while (Date.now() < end) {
    for (const [k, a, rate] of perTick) {
      acc[k] += rate;
      while (acc[k] >= 1) {
        acc[k] -= 1;
        if (inflight >= MAX_INFLIGHT) { stats.dropped++; continue; }
        inflight++;
        stats.inflightMax = Math.max(stats.inflightMax, inflight);
        const p = Promise.resolve(a.run(pick(gyms))).catch(() => {}).finally(() => { inflight--; running.delete(p); });
        running.add(p);
      }
    }
    await new Promise((r) => setTimeout(r, tick));
  }
  clearInterval(hp);
  await Promise.race([Promise.allSettled([...running]), new Promise((r) => setTimeout(r, 20000))]);
  const secs = (performance.now() - stats.started) / 1000;
  const rows = [...stats.byRoute.entries()].map(([label, s]) => ({ label, n: s.n, rps: +(s.n / secs).toFixed(1), errPct: +((100 * s.err) / s.n).toFixed(1), codes: s.codes, p50: Math.round(pct(s.lat, 50)), p95: Math.round(pct(s.lat, 95)), p99: Math.round(pct(s.lat, 99)) }));
  const all = [...stats.byRoute.values()];
  const total = all.reduce((s, x) => s + x.n, 0);
  const errs = all.reduce((s, x) => s + x.err, 0);
  const lat = all.flatMap((x) => x.lat);
  const h = health.filter((x) => x.step === mult);
  const summary = {
    step: mult, requests: total, rps: +(total / secs).toFixed(1), errPct: +((100 * errs) / Math.max(1, total)).toFixed(2),
    p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), p99: Math.round(pct(lat, 99)), dropped: stats.dropped, inflightMax: stats.inflightMax,
    server: h.length ? {
      tasks: new Set(h.map((x) => x.task)).size,
      cpuPctMax: Math.max(...h.map((x) => x.cpuPct)), loopP99Max: Math.max(...h.map((x) => x.loopP99)),
      poolWaitingMax: Math.max(...h.map((x) => x.pool.waiting)), dbConnectionsMax: Math.max(...h.map((x) => x.db.connections)), rssMbMax: Math.max(...h.map((x) => x.rssMb)),
    } : null,
    rows,
  };
  console.log(`→ ${summary.rps} req/s, p50 ${summary.p50} ms, p95 ${summary.p95} ms, p99 ${summary.p99} ms, errors ${summary.errPct}%` + (summary.server ? `, server CPU max ${summary.server.cpuPctMax}%, pool waiting max ${summary.server.poolWaitingMax}, ${summary.server.tasks} task(s) seen` : ""));
  return summary;
}

// ---- go ----
fs.mkdirSync(OUT, { recursive: true });
console.log(`${N} gyms, ${gyms.reduce((s, g) => s + g.members.length, 0)} member sessions, target ${BASE}`);
await pollHealth(0);
if (health[0]) console.log(`server before the test: ${health[0].task}, ${health[0].rssMb} MB, CPU ${health[0].cpuPct}%, database ${health[0].db.size}`);
const results = [];
for (const m of STEPS) {
  const r = await runStep(m);
  results.push(r);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ base: BASE, gyms: N, seconds: SECONDS, results, health }, null, 2));
  if (r.errPct > 5 || r.p95 > 3000) { console.log(`stopping: step x${m} went past the limit (errors > 5% or p95 > 3 s)`); break; }
  await new Promise((r) => setTimeout(r, 15000)); // let the server breathe between steps
}

// ---- report ----
const lines = [`# GMS load test, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "", `Target: ${BASE}. ${N} gyms. Each step lasts ${SECONDS} s. Step x1 is a realistic evening peak for all gyms at once.`, "",
  "| Step | Requests/s | p50 | p95 | p99 | Errors | Server CPU max | Event loop p99 max | Pool waiting max | DB connections max |", "|---|---|---|---|---|---|---|---|---|---|"];
for (const r of results) lines.push(`| x${r.step} | ${r.rps} | ${r.p50} ms | ${r.p95} ms | ${r.p99} ms | ${r.errPct}% | ${r.server?.cpuPctMax ?? "?"}% | ${r.server?.loopP99Max ?? "?"} ms | ${r.server?.poolWaitingMax ?? "?"} | ${r.server?.dbConnectionsMax ?? "?"} |`);
lines.push("", "## Slowest calls, last step", "", "| Call | Requests | p50 | p95 | p99 | Errors |", "|---|---|---|---|---|---|");
for (const row of [...results.at(-1).rows].sort((a, b) => b.p95 - a.p95)) lines.push(`| ${row.label} | ${row.n} | ${row.p50} ms | ${row.p95} ms | ${row.p99} ms | ${row.errPct}% ${Object.keys(row.codes).length ? JSON.stringify(row.codes) : ""} |`);
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n") + "\n");
console.log(`\nreport: ${path.join(OUT, "report.md")}`);
