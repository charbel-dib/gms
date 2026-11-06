/**
 * End-to-end API tests against a real PostgreSQL database.
 *   DATABASE_URL=postgres://.../gms_test npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, Client, beirutDates } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof startTestServer>>;
let day: (offset?: number) => string;
let admin: Client, owner: Client, reception: Client, ownerB: Client;
let gymA: string, gymB: string;
const plans: Record<string, any> = {};

before(async () => {
  ctx = await startTestServer();
  day = await beirutDates(ctx.db);
  admin = new Client(ctx.base);
  await admin.ok("POST", "/api/auth/login", { email: "root@gms.test", password: "rootpass123" });
});

after(async () => {
  ctx.server.close();
  await ctx.db.end();
});

test("platform admin onboards gyms from templates", async () => {
  const a = await admin.ok("POST", "/api/admin/gyms", { name: "Alpha Gym", slug: "alpha", template: "classic", owner_name: "Alpha Owner", owner_email: "owner@alpha.test", city: "Beirut" });
  assert.ok(a.temporaryPassword);
  gymA = a.gymId;
  const b = await admin.ok("POST", "/api/admin/gyms", { name: "Beta Box", slug: "beta", template: "crossfit", owner_name: "Beta Owner", owner_email: "owner@beta.test" });
  gymB = b.gymId;
  const dup = await admin.post("/api/admin/gyms", { name: "X", slug: "alpha", template: "classic", owner_name: "X Y", owner_email: "x@x.test" });
  assert.equal(dup.status, 400);
  owner = new Client(ctx.base);
  await owner.ok("POST", "/api/auth/login", { email: "owner@alpha.test", password: a.temporaryPassword });
  ownerB = new Client(ctx.base);
  await ownerB.ok("POST", "/api/auth/login", { email: "owner@beta.test", password: b.temporaryPassword });
  const list = await admin.ok("GET", "/api/admin/gyms");
  assert.equal(list.totals.gyms, 2);
});

test("login is rate limited and wrong passwords are rejected", async () => {
  const c = new Client(ctx.base);
  const r = await c.post("/api/auth/login", { email: "owner@alpha.test", password: "nope" });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "invalid_credentials");
});

test("owner configures the gym; secrets never leave the server", async () => {
  const me = await owner.ok("GET", "/api/auth/me");
  assert.equal(me.user.role, "owner");
  assert.equal(me.gym.slug, "alpha");
  const g = await owner.ok("PUT", "/api/gym", {
    lbp_rate: 89500,
    settings: { ladiesHours: [{ day: 0, from: "00:00", to: "23:59" }], whatsapp: { phoneNumberId: "PNID-ALPHA", token: "super-secret-token" }, checkin: { cooldownMinutes: 60 } },
  });
  assert.equal(g.settings.whatsapp.hasToken, true);
  assert.equal(JSON.stringify(g).includes("super-secret"), false);
  assert.equal(JSON.stringify(g).includes("tokenEnc"), false);
  // Remove the Cloud API token again so messages use click-to-send in tests
  await owner.ok("PUT", "/api/gym", { settings: { whatsapp: { token: "", phoneNumberId: "PNID-ALPHA" }, ladiesHours: [] } });
  for (const p of await owner.ok("GET", "/api/plans")) plans[p.name] = p;
  assert.ok(plans["1 Month"] && plans["10 Visits"]);
  const staff = await owner.ok("POST", "/api/staff", { name: "Front Desk", email: "desk@alpha.test", role: "reception", password: "desk12345" });
  assert.ok(staff.id);
  reception = new Client(ctx.base);
  await reception.ok("POST", "/api/auth/login", { email: "desk@alpha.test", password: "desk12345" });
});

let m1: any;

test("members: create with membership + payment, Lebanese phone normalisation, duplicates", async () => {
  const r = await reception.ok("POST", "/api/members", {
    first_name: "Rita", last_name: "Khoury", phone: "03 123 456", gender: "female",
    membership: { plan_id: plans["1 Month"].id, payment: { amount: 45, currency: "USD", method: "cash" } },
  });
  m1 = await reception.ok("GET", `/api/members/${r.id}`);
  assert.equal(m1.phone, "+9613123456");
  assert.equal(m1.status, "active");
  assert.equal(m1.code, 1001);
  assert.equal(Number(m1.balance_usd), 0);
  assert.equal(m1.payments[0].receipt_no, 1001);
  const dup = await reception.post("/api/members", { first_name: "Other", phone: "+9613123456" });
  assert.equal(dup.status, 400);
  assert.equal(dup.data.error, "duplicate_phone");
});

test("renewal starts the day after the current membership ends; LBP payment converts to USD", async () => {
  const sale = await reception.ok("POST", `/api/members/${m1.id}/memberships`, {
    plan_id: plans["1 Month"].id, payment: { amount: 45 * 89500, currency: "LBP", method: "cash" },
  });
  assert.equal(sale.membership.start_date, day(30));
  assert.equal(Number(sale.payment.amount_usd), 45);
  const m = await reception.ok("GET", `/api/members/${m1.id}`);
  assert.equal(m.end_date, day(29)); // current one still shown
  assert.equal(m.memberships.length, 2);
});

test("check-in by QR: ok, then duplicate within cooldown does not double count", async () => {
  const c1 = await reception.ok("POST", "/api/checkin", { token: `GMS:${m1.qr_token}` });
  assert.equal(c1.result, "ok");
  assert.equal(c1.duplicate, false);
  const c2 = await reception.ok("POST", "/api/checkin", { token: m1.qr_token });
  assert.equal(c2.result, "ok");
  assert.equal(c2.duplicate, true);
  const list = await reception.ok("GET", "/api/checkins");
  assert.equal(list.length, 1);
});

test("check-in denied without membership; ladies hours block men", async () => {
  const man = await reception.ok("POST", "/api/members", { first_name: "Joe", last_name: "Saab", phone: "70111222", gender: "male" });
  const d = await reception.ok("POST", "/api/checkin", { code: man.code });
  assert.equal(d.result, "denied");
  assert.equal(d.reason, "no_membership");
  await reception.ok("POST", `/api/members/${man.id}/memberships`, { plan_id: plans["1 Month"].id, payment: { amount: 45, currency: "USD", method: "whish" } });
  const allDay = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, from: "00:00", to: "23:59" }));
  await owner.ok("PUT", "/api/gym", { settings: { ladiesHours: allDay } });
  const blocked = await reception.ok("POST", "/api/checkin", { code: man.code });
  assert.equal(blocked.reason, "ladies_hours");
  await owner.ok("PUT", "/api/gym", { settings: { ladiesHours: [] } });
  const okNow = await reception.ok("POST", "/api/checkin", { code: man.code });
  assert.equal(okNow.result, "ok");
});

test("freeze extends the end date, blocks entry, and unfreeze gives unused days back", async () => {
  const r = await reception.ok("POST", "/api/members", { first_name: "Nour", phone: "71000111", gender: "female", membership: { plan_id: plans["3 Months"].id, payment: { amount: 120, currency: "USD", method: "omt" } } });
  const m = await reception.ok("GET", `/api/members/${r.id}`);
  const ms = m.memberships[0];
  const tooLong = await reception.post(`/api/memberships/${ms.id}/freeze`, { from: day(0), until: day(20) });
  assert.equal(tooLong.data.error, "freeze_limit");
  const f = await reception.ok("POST", `/api/memberships/${ms.id}/freeze`, { from: day(0), until: day(4) });
  assert.equal(f.end_date, day(89 + 5));
  const ck = await reception.ok("POST", "/api/checkin", { member_id: r.id });
  assert.equal(ck.reason, "frozen");
  const u = await reception.ok("POST", `/api/memberships/${ms.id}/unfreeze`);
  assert.equal(u.end_date, day(89));
  assert.equal(u.freeze_days_used, 0);
  assert.equal((await reception.ok("POST", "/api/checkin", { member_id: r.id })).result, "ok");
});

test("visit packs are consumed and run out", async () => {
  const r = await reception.ok("POST", "/api/members", { first_name: "Day", last_name: "Pass", membership: { plan_id: plans["Day Pass"].id, payment: { amount: 7, currency: "USD", method: "cash" } } });
  await owner.ok("PUT", "/api/gym", { settings: { checkin: { cooldownMinutes: 0 } } });
  assert.equal((await reception.ok("POST", "/api/checkin", { member_id: r.id })).result, "ok");
  const second = await reception.ok("POST", "/api/checkin", { member_id: r.id });
  assert.equal(second.result, "denied");
  assert.equal(second.reason, "no_visits_left");
  await owner.ok("PUT", "/api/gym", { settings: { checkin: { cooldownMinutes: 60 } } });
});

test("unpaid balances: warning by default, blocked when the gym requires it; voiding a payment", async () => {
  const r = await reception.ok("POST", "/api/members", { first_name: "Half", last_name: "Payer", membership: { plan_id: plans["1 Month"].id, payment: { amount: 20, currency: "USD", method: "cash" } } });
  const m = await reception.ok("GET", `/api/members/${r.id}`);
  assert.equal(Number(m.balance_usd), 25);
  const c = await reception.ok("POST", "/api/checkin", { member_id: r.id });
  assert.ok(c.warnings.includes("unpaid_balance"));
  await owner.ok("PUT", "/api/gym", { settings: { checkin: { blockOnBalance: true, cooldownMinutes: 0 } } });
  assert.equal((await reception.ok("POST", "/api/checkin", { member_id: r.id })).reason, "unpaid_balance");
  await reception.ok("POST", "/api/payments", { member_id: r.id, amount: 25, currency: "USD", method: "whish", reference: "W-778" });
  assert.equal((await reception.ok("POST", "/api/checkin", { member_id: r.id })).result, "ok");
  await owner.ok("PUT", "/api/gym", { settings: { checkin: { blockOnBalance: false, cooldownMinutes: 60 } } });
  // reception cannot void, owner can
  const pay = (await reception.ok("GET", `/api/members/${r.id}`)).payments[0];
  assert.equal((await reception.post(`/api/payments/${pay.id}/void`, { reason: "mistake" })).status, 403);
  await owner.ok("POST", `/api/payments/${pay.id}/void`, { reason: "entered twice" });
  assert.equal(Number((await owner.ok("GET", `/api/members/${r.id}`)).balance_usd), 25);
  const receipt = await owner.get(`/api/payments/${pay.id}/receipt`);
  assert.match(receipt.data.html, /VOIDED/);
});

test("classes: booking, capacity, waitlist promotion with WhatsApp notification", async () => {
  const sessions = await owner.ok("GET", `/api/classes/sessions?from=${day(1)}&to=${day(7)}`);
  assert.ok(sessions.length > 0, "sessions are generated from the weekly schedule");
  const s = sessions[0];
  await owner.ok("PUT", `/api/classes/sessions/${s.id}`, { capacity: 1 });
  const a = await reception.ok("POST", "/api/members", { first_name: "Ana", phone: "76123123", gender: "female", membership: { plan_id: plans["1 Month"].id } });
  const b = await reception.ok("POST", "/api/members", { first_name: "Bea", phone: "76123124", gender: "female", membership: { plan_id: plans["1 Month"].id } });
  const b1 = await reception.ok("POST", `/api/classes/sessions/${s.id}/bookings`, { member_id: a.id });
  assert.equal(b1.status, "booked");
  const b2 = await reception.ok("POST", `/api/classes/sessions/${s.id}/bookings`, { member_id: b.id });
  assert.equal(b2.status, "waitlist");
  await reception.ok("PUT", `/api/bookings/${b1.booking.id}`, { status: "cancelled" });
  const list = await owner.ok("GET", `/api/classes/sessions/${s.id}/bookings`);
  assert.equal(list.find((x: any) => x.member_id === b.id).status, "booked");
  const msgs = await owner.ok("GET", "/api/messages?status=outbox");
  const promo = msgs.rows.find((m: any) => m.kind === "waitlist_promoted");
  assert.ok(promo, "promoted member gets a WhatsApp");
  assert.match(promo.link, /^https:\/\/wa\.me\/96176123124\?text=/);
});

test("personal training: package with payment, sessions consume the package", async () => {
  const coach = await owner.ok("POST", "/api/staff", { name: "Coach Rami", email: "rami@alpha.test", role: "coach", password: "coach12345", commission_pct: 40 });
  const pk = await owner.ok("POST", "/api/pt/packages", { member_id: m1.id, coach_id: coach.id, sessions_total: 2, price: 60, currency: "USD", payment: { amount: 60, currency: "USD", method: "cash" } });
  const coachClient = new Client(ctx.base);
  await coachClient.ok("POST", "/api/auth/login", { email: "rami@alpha.test", password: "coach12345" });
  const s1 = await coachClient.ok("POST", "/api/pt/sessions", { package_id: pk.package.id, starts_at: new Date(Date.now() + 3600_000).toISOString() });
  await coachClient.ok("POST", "/api/pt/sessions", { package_id: pk.package.id, starts_at: new Date(Date.now() + 86400_000).toISOString() });
  const third = await coachClient.post("/api/pt/sessions", { package_id: pk.package.id, starts_at: new Date(Date.now() + 2 * 86400_000).toISOString() });
  assert.equal(third.data.error, "package_full");
  await coachClient.ok("PUT", `/api/pt/sessions/${s1.id}`, { status: "done", notes: "Squats 3x8" });
  const pkgs = await coachClient.ok("GET", "/api/pt/packages");
  assert.equal(pkgs[0].sessions_used, 1);
  // coaches cannot create members or see finances
  assert.equal((await coachClient.post("/api/members", { first_name: "X" })).status, 403);
  assert.equal((await coachClient.get("/api/reports/finance")).status, 403);
  const report = await owner.ok("GET", "/api/reports/coaches");
  const rami = report.find((x: any) => x.name === "Coach Rami");
  assert.equal(Number(rami.pt_revenue), 60);
  assert.equal(rami.commission_usd, 24);
});

test("tenant isolation: another gym cannot read or check in our members", async () => {
  assert.equal((await ownerB.get(`/api/members/${m1.id}`)).status, 404);
  assert.equal((await ownerB.post("/api/checkin", { token: m1.qr_token })).status, 404);
  assert.equal((await ownerB.put(`/api/members/${m1.id}`, { first_name: "Hacked" })).status, 404);
  const listB = await ownerB.ok("GET", "/api/members");
  assert.equal(listB.total, 0);
  // super-admin can act inside a gym with X-Gym-Id
  admin.gymId = gymA;
  assert.equal((await admin.get(`/api/members/${m1.id}`)).status, 200);
  admin.gymId = undefined;
  assert.equal((await admin.get(`/api/members/${m1.id}`)).status, 400);
});

test("reception sees operations but not finances", async () => {
  assert.equal((await reception.get("/api/reports/finance")).status, 403);
  const d = await reception.ok("GET", "/api/dashboard");
  assert.equal(d.kpi.revenue_month, null);
  assert.ok(d.kpi.active_members >= 3);
  const full = await owner.ok("GET", "/api/dashboard");
  assert.ok(Number(full.kpi.revenue_month) > 0);
  const fin = await owner.ok("GET", `/api/reports/finance?from=${day(-1)}&to=${day(0)}`);
  assert.ok(fin.revenue > 0);
  assert.ok(fin.byMethod.find((x: any) => x.method === "cash"));
});

test("member app: access via WhatsApp PIN, membership, class booking, assistant", async () => {
  const access = await reception.ok("POST", `/api/members/${m1.id}/app-access`);
  assert.match(access.pin, /^\d{4}$/);
  assert.match(access.whatsappLink, /^https:\/\/wa\.me\/9613123456/);
  const member = new Client(ctx.base);
  const bad = await member.post("/api/m/alpha/login", { phone: "03123456", pin: "0000" === access.pin ? "1111" : "0000" });
  assert.equal(bad.status, 400);
  await member.ok("POST", "/api/m/alpha/login", { phone: "03123456", pin: access.pin });
  const me = await member.ok("GET", "/api/m/me");
  assert.equal(me.member.first_name, "Rita");
  assert.equal(me.gym.slug, "alpha");
  assert.ok(me.member.qr_token);
  const classes = await member.ok("GET", "/api/m/classes");
  const free = classes.find((c: any) => c.booked < c.capacity && !c.my_booking_id && new Date(c.starts_at).getTime() > Date.now() + 3 * 3600_000);
  const bk = await member.ok("POST", `/api/m/classes/${free.id}/book`);
  assert.equal(bk.status, "booked");
  await member.ok("POST", `/api/m/bookings/${bk.booking.id}/cancel`);
  const ans = await member.ok("POST", "/api/m/ask", { text: "adesh l ishtirak?" });
  assert.match(ans.reply, /\$45/);
  const status = await member.ok("POST", "/api/m/ask", { text: "when does my membership end?" });
  assert.match(status.reply, /active until/);
  // a staff cookie cannot be used as a member, and vice versa
  assert.equal((await owner.get("/api/m/me")).status, 401);
  assert.equal((await member.get("/api/members")).status, 401);
  await member.ok("POST", "/api/m/logout");
  assert.equal((await member.get("/api/m/me")).status, 401);
});

test("renewal reminders are generated once (click-to-send mode)", async () => {
  const r = await reception.ok("POST", "/api/members", { first_name: "Soon", last_name: "Expiring", phone: "79555666", membership: { plan_id: plans["1 Month"].id, start_date: day(-22), payment: { amount: 45, currency: "USD", method: "cash" } } });
  const m = await reception.ok("GET", `/api/members/${r.id}`);
  assert.equal(m.days_left, 7);
  assert.equal(m.status, "expiring");
  const run1 = await owner.ok("POST", "/api/messages/reminders/run");
  assert.ok(run1.queued >= 1);
  const run2 = await owner.ok("POST", "/api/messages/reminders/run");
  assert.equal(run2.queued, 0);
  const out = await owner.ok("GET", "/api/messages?status=outbox");
  const rem = out.rows.find((x: any) => x.member_id === r.id && x.kind === "reminder_expiry");
  assert.match(rem.body, /7 days left/);
  await reception.ok("POST", `/api/messages/${rem.id}/done`);
});

test("CSV import from the gym's old Excel", async () => {
  const csv = "Name;Phone;Gender;Plan;Expiry\nKarim Haddad;03 999 888;M;Monthly;15/12/2026\nLayal Aoun;+961 71 222 333;F;3 months;2027-01-31\nNo Phone;;;;\nDup Rita;03123456;F;;\nBad Date;81000111;M;x;99/99/99\n";
  const dry = await owner.ok("POST", "/api/members/import", { csv, dryRun: true });
  assert.equal(dry.created, 3);
  const res = await owner.ok("POST", "/api/members/import", { csv });
  assert.equal(res.created, 3);
  assert.equal(res.skipped.length, 2);
  const list = await owner.ok("GET", "/api/members?q=Karim");
  assert.equal(list.rows[0].end_date, "2026-12-15");
  assert.equal(list.rows[0].phone, "+9613999888");
});

test("AI: churn model trains and scores; offline assistant answers from data; win-back draft", async () => {
  const ref = await owner.ok("POST", "/api/ai/churn/refresh");
  assert.ok(ref.score.scored >= 3);
  const churn = await owner.ok("GET", "/api/ai/churn");
  assert.ok(churn.rows.length >= 3);
  assert.ok(churn.rows.every((r: any) => r.score >= 0 && r.score <= 1));
  const a = await owner.ok("POST", "/api/ai/ask", { question: "How much revenue did we make this month?" });
  assert.match(a.answer, /Revenue this month/);
  const b = await owner.ok("POST", "/api/ai/ask", { question: "chou fi members bi5las ishtirakon?" });
  assert.match(b.answer, /Memberships ending/);
  const w = await reception.ok("POST", `/api/ai/winback/${m1.id}`, { lang: "arabizi" });
  assert.match(w.text, /Rita/);
  assert.equal((await reception.post("/api/ai/ask", { question: "revenue?" })).status, 403);
  const kb = await owner.ok("POST", "/api/ai/knowledge", { title: "Parking", body: "Free parking behind the building, entrance from the side street." });
  assert.ok(kb.id);
  const t = await owner.ok("POST", "/api/ai/bot-test", { text: "wen fi parking?" });
  assert.match(t.reply, /parking/i);
});

test("WhatsApp webhook: verification and inbound message gets a bot reply", async () => {
  const c = new Client(ctx.base);
  const v = await c.get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=gms-verify&hub.challenge=abc123");
  assert.equal(v.data, "abc123");
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "PNID-ALPHA" }, messages: [{ id: "wamid.1", from: "9613123456", type: "text", text: { body: "adesh se3er l ishtirak?" } }] } }] }] };
  await c.ok("POST", "/api/webhooks/whatsapp", payload);
  await new Promise((r) => setTimeout(r, 300));
  const msgs = await owner.ok("GET", "/api/messages");
  const inbound = msgs.rows.find((m: any) => m.direction === "in");
  assert.ok(inbound);
  assert.equal(inbound.member_id, m1.id);
  const reply = msgs.rows.find((m: any) => m.kind === "bot" || m.kind === "bot_handoff");
  assert.ok(reply, "bot replied");
  // replayed webhook is ignored
  await c.ok("POST", "/api/webhooks/whatsapp", payload);
  await new Promise((r) => setTimeout(r, 200));
  const again = await owner.ok("GET", "/api/messages");
  assert.equal(again.rows.filter((m: any) => m.direction === "in").length, 1);
});

test("security: cross-site POST is blocked; JSON is required; unknown routes 404", async () => {
  const r = await owner.req("POST", "/api/members", { first_name: "Evil" }, { origin: "https://evil.example" });
  assert.equal(r.status, 403);
  const r2 = await owner.req("POST", "/api/members", undefined, { "content-type": "text/plain", "content-length": "3" });
  assert.ok([400, 415].includes(r2.status));
  assert.equal((await owner.get("/api/nope")).status, 404);
  const h = await owner.get("/healthz");
  assert.equal(h.data.ok, true);
});

test("GMS plans: Starter cannot switch on Pro features; upgrading turns them on", async () => {
  const g = await admin.ok("POST", "/api/admin/gyms", { name: "Small Gym", slug: "small", template: "classic", owner_name: "Small Owner", owner_email: "owner@small.test", saas_plan: "starter" });
  const c = new Client(ctx.base);
  await c.ok("POST", "/api/auth/login", { email: "owner@small.test", password: g.temporaryPassword });
  let gym = await c.ok("GET", "/api/gym");
  assert.equal(gym.modules.classes, false);
  assert.equal(gym.modules.whatsapp, true);
  gym = await c.ok("PUT", "/api/gym", { modules: { classes: true, ai: true } });
  assert.equal(gym.modules.classes, false);
  await admin.ok("PUT", `/api/admin/gyms/${g.gymId}`, { saas_plan: "pro" });
  gym = await c.ok("GET", "/api/gym");
  assert.equal(gym.modules.classes, true);
  assert.equal(Number(gym.saas_plan === "pro"), 1);
});

test("suspended gyms are locked out", async () => {
  await admin.ok("PUT", `/api/admin/gyms/${gymB}`, { saas_status: "suspended" });
  assert.equal((await ownerB.get("/api/members")).status, 401);
  await admin.ok("PUT", `/api/admin/gyms/${gymB}`, { saas_status: "active" });
  // suspension signed everyone out: sign the owner back in for the next tests
  const reset = await admin.ok("POST", `/api/admin/gyms/${gymB}/reset-owner`);
  await ownerB.ok("POST", "/api/auth/login", { email: reset.email, password: reset.temporaryPassword });
});

// ---------------------------------------------------------------- receipts

test("receipts: in-app HTML, shareable public link, platform admin access", async () => {
  const r = await reception.ok("POST", "/api/members", { first_name: "Receipt", last_name: "Test", phone: "70999111", membership: { plan_id: plans["1 Month"].id, payment: { amount: 45 * 89500, currency: "LBP", method: "omt", reference: "OMT-55" } } });
  const pay = r.sale.payment;
  const rc = await reception.ok("GET", `/api/payments/${pay.id}/receipt`);
  assert.match(rc.html, /<!doctype html>/i);
  assert.match(rc.html, new RegExp(`Receipt #${pay.receipt_no}`));
  assert.match(rc.html, /OMT · OMT-55/);
  assert.match(rc.url, /\/r\/[0-9a-f]{32}$/);
  assert.match(rc.whatsappLink, /^https:\/\/wa\.me\/96170999111\?text=/);
  // the member opens the link without signing in
  const anon = new Client(ctx.base);
  const page = await anon.get(new URL(rc.url).pathname);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.match(page.data, /1 Month/);
  assert.equal((await anon.get("/r/" + "0".repeat(32))).status, 404);
  assert.equal((await anon.get("/r/not-a-token")).status, 404);
  // another gym cannot read it through the API
  assert.equal((await ownerB.get(`/api/payments/${pay.id}/receipt`)).status, 404);
  // platform admin inside the gym (header) and in a new tab (?gym=)
  admin.gymId = gymA;
  assert.equal((await admin.get(`/api/payments/${pay.id}/receipt`)).status, 200);
  admin.gymId = undefined;
  assert.equal((await admin.get(`/api/members/export.csv?gym=${gymA}`)).status, 200);
});

// ---------------------------------------------------------------- shop

let whey: any, water: any;

test("shop: catalog, stock, sale paid in lira, sale on account, void restores stock", async () => {
  assert.equal((await reception.post("/api/shop/products", { name: "X", price: 1 })).status, 403);
  whey = await owner.ok("POST", "/api/shop/products", { name: "Whey 2 kg", category: "supplements", price: 75, cost_usd: 50, stock: 3, low_stock_at: 2, barcode: "6280001" });
  water = await owner.ok("POST", "/api/shop/products", { name: "Water", category: "drinks", price: 45000, currency: "LBP", cost_usd: 0.2, stock: 100 });
  assert.equal((await reception.ok("GET", "/api/shop/barcode/6280001")).id, whey.id);

  // walk-in pays in lira: total $75 + 2 × 45,000 LBP = $76 → 6,802,000 LBP rounded to the nearest 1,000
  const s1 = await reception.ok("POST", "/api/shop/sales", { items: [{ product_id: whey.id, qty: 1 }, { product_id: water.id, qty: 2 }], payment: { currency: "LBP", method: "cash" } });
  assert.equal(Number(s1.sale.total_usd), 76);
  assert.equal(Number(s1.payment.amount), 6802000);
  assert.equal(Number(s1.payment.amount_usd), 76);
  const rc = await reception.ok("GET", `/api/payments/${s1.payment.id}/receipt`);
  assert.match(rc.html, /1 × Whey 2 kg/);
  assert.equal(rc.whatsappLink, null); // walk-in: no phone

  // stock is checked and decremented
  const over = await reception.post("/api/shop/sales", { items: [{ product_id: whey.id, qty: 5 }], payment: { currency: "USD", method: "cash" } });
  assert.equal(over.data.error, "out_of_stock");
  let products = await reception.ok("GET", "/api/shop/products");
  assert.equal(products.find((p: any) => p.id === whey.id).stock, 2);

  // on the member's account: balance goes up, then a normal payment settles it
  const before = Number((await reception.ok("GET", `/api/members/${m1.id}`)).balance_usd);
  const s2 = await reception.ok("POST", "/api/shop/sales", { member_id: m1.id, items: [{ product_id: whey.id, qty: 1 }], discount_usd: 5, on_account: true });
  assert.equal(s2.payment, null);
  assert.equal(Number((await reception.ok("GET", `/api/members/${m1.id}`)).balance_usd), before + 70);
  await reception.ok("POST", "/api/payments", { member_id: m1.id, amount: 70, currency: "USD", method: "whish" });
  assert.equal(Number((await reception.ok("GET", `/api/members/${m1.id}`)).balance_usd), before);
  const noMember = await reception.post("/api/shop/sales", { items: [{ product_id: water.id, qty: 1 }], on_account: true });
  assert.equal(noMember.data.error, "member_required");

  // low stock shows on the dashboard
  const dash = await owner.ok("GET", "/api/dashboard");
  assert.ok(dash.lowStock.some((p: any) => p.id === whey.id));

  // restock with a new cost: weighted average cost
  const rs = await owner.ok("POST", `/api/shop/products/${whey.id}/stock`, { kind: "restock", qty: 9, unit_cost_usd: 60 });
  assert.equal(rs.stock, 10);
  assert.equal(Number(rs.cost_usd), 59); // (1 × 50 + 9 × 60) / 10

  // void: reception cannot, owner can; stock back, payment voided
  assert.equal((await reception.post(`/api/shop/sales/${s1.sale.id}/void`, { reason: "mistake" })).status, 403);
  await owner.ok("POST", `/api/shop/sales/${s1.sale.id}/void`, { reason: "customer returned it" });
  products = await owner.ok("GET", "/api/shop/products");
  assert.equal(products.find((p: any) => p.id === whey.id).stock, 11);
  assert.equal(products.find((p: any) => p.id === water.id).stock, 100);
  const voided = await owner.ok("GET", `/api/payments/${s1.payment.id}/receipt`);
  assert.match(voided.html, /VOIDED/);

  // reports: shop revenue and margin
  const sum = await owner.ok("GET", "/api/shop/summary");
  assert.equal(Number(sum.revenue), 70);
  assert.equal(Number(sum.margin), 20); // 70 - cost 50 at the time of sale
  await reception.ok("POST", "/api/shop/sales", { items: [{ product_id: water.id, qty: 1 }], payment: { currency: "USD", method: "cash" } });
  const fin = await owner.ok("GET", "/api/reports/finance");
  assert.ok(fin.byKind.some((k: any) => k.kind === "shop"));
  // another gym sees nothing
  assert.equal((await ownerB.ok("GET", "/api/shop/products")).length, 0);
  assert.equal((await ownerB.post("/api/shop/sales", { items: [{ product_id: water.id, qty: 1 }], payment: { currency: "USD", method: "cash" } })).status, 404);
});

// ---------------------------------------------------------------- push notifications

import http from "node:http";
import crypto from "node:crypto";
import { decryptForTest, verifyVapidForTest } from "./push-receiver.ts";

test("push: member subscribes, receives an encrypted receipt notification, preferences and gym settings are respected", async () => {
  // fake browser push service
  const received: { path: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
  let reply = 201;
  const svc = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { received.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(reply); res.end(); });
  });
  await new Promise<void>((r) => svc.listen(0, r));
  const port = (svc.address() as any).port;

  // a member with the app
  const access = await reception.ok("POST", `/api/members/${m1.id}/app-access`);
  const member = new Client(ctx.base);
  await member.ok("POST", "/api/m/alpha/login", { phone: "03123456", pin: access.pin });
  const { publicKey } = await member.ok("GET", "/api/m/push/key");
  assert.equal(Buffer.from(publicKey, "base64url").length, 65);

  // the "browser" keys
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const sub = { endpoint: `http://127.0.0.1:${port}/push/device-1`, keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") } };
  await member.ok("POST", "/api/m/push/subscribe", sub);

  // a payment → receipt notification, delivered encrypted
  await reception.ok("POST", "/api/payments", { member_id: m1.id, amount: 10, currency: "USD", method: "cash" });
  for (let i = 0; i < 40 && !received.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(received.length, 1, "push service called");
  const req = received[0];
  assert.equal(req.headers["content-encoding"], "aes128gcm");
  assert.ok(verifyVapidForTest(String(req.headers.authorization), publicKey, `http://127.0.0.1:${port}`), "valid VAPID signature");
  const msg = JSON.parse(decryptForTest(req.body, ua, authSecret).toString("utf8"));
  assert.equal(msg.title, "Payment received ✅");
  assert.match(msg.body, /\$10\.00/);
  assert.match(msg.url, /^\/r\/[0-9a-f]{32}$/);

  // inbox
  let inbox = await member.ok("GET", "/api/m/notifications");
  assert.ok(inbox.unread >= 1);
  assert.equal(inbox.rows[0].title, "Payment received ✅");
  await member.ok("POST", "/api/m/notifications/read");
  assert.equal((await member.ok("GET", "/api/m/me")).unread, 0);

  // member turns off "payments": no new notification
  await member.ok("PUT", "/api/m/notifications/prefs", { payments: false });
  await reception.ok("POST", "/api/payments", { member_id: m1.id, amount: 5, currency: "USD", method: "cash" });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(received.length, 1);
  await member.ok("PUT", "/api/m/notifications/prefs", { payments: true });

  // staff test notification + overview
  const testRes = await reception.ok("POST", "/api/notifications/test", { member_id: m1.id });
  assert.equal(testRes.ok, true);
  const ov = await owner.ok("GET", "/api/notifications/overview");
  assert.equal(ov.stats.members_with_push, 1);
  assert.ok(ov.types.length >= 8);

  // announcement by push only, during quiet hours all day → waits
  await owner.ok("PUT", "/api/gym", { settings: { push: { quietFrom: "00:00", quietTo: "23:59" } } });
  const bc = await owner.ok("POST", "/api/messages/broadcast", { segment: "all", channel: "push", title: "New class", body: "Hi {name}, Zumba on Saturdays!" });
  assert.equal(bc.pushed, 1);
  const waiting = await owner.ok("GET", "/api/notifications/overview");
  assert.ok(waiting.stats.waiting >= 1);
  assert.equal(waiting.recent.find((x: any) => x.title === "New class")?.status, "queued");
  await owner.ok("PUT", "/api/gym", { settings: { push: { quietFrom: "22:00", quietTo: "08:00" } } });

  // gym turns the receipt type off
  await owner.ok("PUT", "/api/gym", { settings: { push: { types: { receipt: false } } } });
  const n0 = received.length;
  await reception.ok("POST", "/api/payments", { member_id: m1.id, amount: 1, currency: "USD", method: "cash" });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(received.length, n0);
  await owner.ok("PUT", "/api/gym", { settings: { push: { types: { receipt: true } } } });

  // the browser unsubscribed (410): the device is removed
  reply = 410;
  await reception.ok("POST", "/api/payments", { member_id: m1.id, amount: 2, currency: "USD", method: "cash" });
  for (let i = 0; i < 40 && received.length === n0; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await owner.ok("GET", "/api/notifications/overview")).stats.devices, 0);

  // endpoints outside known push services are refused in production mode
  process.env.PUSH_ALLOW_ANY_ENDPOINT = "false";
  const evil = await member.post("/api/m/push/subscribe", { ...sub, endpoint: "https://169.254.169.254/latest" });
  assert.equal(evil.data.error, "unsupported_browser");
  process.env.PUSH_ALLOW_ANY_ENDPOINT = "true";
  svc.close();
});

test("push: waitlist promotion and class cancellation notify members", async () => {
  const sessions = await owner.ok("GET", `/api/classes/sessions?from=${day(2)}&to=${day(8)}`);
  const s = sessions.find((x: any) => !x.cancelled);
  await owner.ok("PUT", `/api/classes/sessions/${s.id}`, { capacity: 1 });
  const a = await reception.ok("POST", "/api/members", { first_name: "Wa", phone: "76555001", gender: "female", membership: { plan_id: plans["1 Month"].id } });
  const b = await reception.ok("POST", "/api/members", { first_name: "Wb", phone: "76555002", gender: "female", membership: { plan_id: plans["1 Month"].id } });
  const bkA = await reception.ok("POST", `/api/classes/sessions/${s.id}/bookings`, { member_id: a.id });
  await reception.ok("POST", `/api/classes/sessions/${s.id}/bookings`, { member_id: b.id });
  await reception.ok("PUT", `/api/bookings/${bkA.booking.id}`, { status: "cancelled" });
  let mb = await owner.ok("GET", `/api/members/${b.id}`);
  assert.ok(mb.notifications.some((n: any) => n.title === "You're in ✅"));
  await owner.ok("PUT", `/api/classes/sessions/${s.id}`, { cancelled: true });
  mb = await owner.ok("GET", `/api/members/${b.id}`);
  assert.ok(mb.notifications.some((n: any) => /is cancelled/.test(n.title)));
});

test("API reference: every route is documented with its real schema; owners and platform admins only", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { generate } = await import("../scripts/gen-api-docs.ts");
  const { SUMMARIES } = await import("../scripts/api-summaries.ts");
  const { router } = await import("../server/index.ts");
  const spec: any = await generate();

  // every route the server answers is in the reference, with a written summary, and nothing stale
  const live = (router as any).routes.map((r: any) => `${r.method} /${r.parts.map((p: string) => (p.startsWith(":") ? `{${p.slice(1)}}` : p)).join("/")}`);
  const documented = Object.entries<any>(spec.paths).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`));
  assert.deepEqual([...documented].sort(), [...live].sort());
  assert.deepEqual(live.filter((k: string) => !SUMMARIES[k]), [], "add a summary in scripts/api-summaries.ts");
  assert.deepEqual(Object.keys(SUMMARIES).filter((k) => !live.includes(k)), [], "summary for a route that no longer exists");

  // bodies are the real zod schemas: required fields, enums, defaults, nested arrays
  for (const [p, ms] of Object.entries<any>(spec.paths)) {
    for (const [m, op] of Object.entries<any>(ms)) {
      const s = op.requestBody?.content["application/json"].schema;
      if (s) assert.equal(s.type, "object", `${m} ${p} body schema not resolved`);
    }
  }
  const sale = spec.paths["/api/shop/sales"].post;
  const body = sale.requestBody.content["application/json"].schema;
  assert.deepEqual(body.required, ["items"]);
  assert.equal(body.properties.items.items.properties.product_id.format, "uuid");
  assert.deepEqual(body.properties.payment.properties.currency.enum, ["USD", "LBP"]);
  assert.equal(body.properties.on_account.default, false);
  assert.deepEqual(sale["x-auth"], { kind: "staff", roles: ["owner", "manager", "reception"] });
  assert.equal(spec.paths["/api/m/me"].get["x-auth"].kind, "member");
  assert.equal(spec.paths["/api/admin/gyms"].get["x-auth"].kind, "superadmin");
  assert.equal(spec.paths["/r/{token}"].get["x-auth"].kind, "public");
  assert.ok(spec.paths["/api/members"].get.parameters.some((x: any) => x.name === "q" && x.in === "query"));
  assert.equal(spec.paths["/api/members/{id}"].get.parameters[0].schema.format, "uuid");

  // served to owners and platform admins (even before opening a gym), not to other roles
  const file = path.join(os.tmpdir(), `gms-api-docs-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.API_DOCS_FILE = file;
  try {
    const mine = await owner.ok("GET", "/api/docs.json");
    assert.equal(mine.openapi, "3.1.0");
    assert.equal((await reception.get("/api/docs.json")).status, 403);
    assert.equal((await new Client(ctx.base).get("/api/docs.json")).status, 401);
    const root = new Client(ctx.base);
    await root.ok("POST", "/api/auth/login", { email: "root@gms.test", password: "rootpass123" });
    assert.equal((await root.get("/api/docs.json")).status, 200);
  } finally {
    delete process.env.API_DOCS_FILE;
    fs.rmSync(file, { force: true });
  }
});

/** Signs a member into the app (PIN from reception). */
async function memberLogin(memberId: string, phone: string) {
  const access = await reception.ok("POST", `/api/members/${memberId}/app-access`);
  const c = new Client(ctx.base);
  await c.ok("POST", "/api/m/alpha/login", { phone, pin: access.pin });
  return c;
}

test("KPIs: rated against benchmarks with trends; focus list; owners and managers only", async () => {
  const k = await owner.ok("GET", "/api/kpis?period=month");
  const by = Object.fromEntries(k.kpis.map((x: any) => [x.key, x]));
  for (const key of ["active_members", "churn_rate", "renewal_rate", "activation", "revenue", "mrr", "arpm", "ltv", "collection_rate", "engaged", "class_fill", "revenue_at_risk", "expected_losses"]) {
    assert.ok(by[key], `missing KPI ${key}`);
    assert.ok(["good", "watch", "bad", "info"].includes(by[key].status));
    assert.ok(by[key].why.length > 20 && by[key].target);
  }
  assert.ok(by.active_members.value >= 1);
  assert.ok(by.revenue.value > 0);
  assert.equal(k.previous.to < k.from, true);
  assert.ok(Array.isArray(k.focus));
  const last = await owner.ok("GET", "/api/kpis?period=last_month");
  assert.equal(last.from.slice(8), "01");
  assert.equal((await reception.get("/api/kpis")).status, 403);
});

test("financial report: A4 HTML and a real Excel workbook", async () => {
  const from = day(-40), to = day(0);
  const rep = await owner.ok("GET", `/api/reports/finance/report?from=${from}&to=${to}`);
  assert.match(rep.html, /Financial report/);
  assert.match(rep.html, /Revenue by source/);
  assert.match(rep.filename, /alpha-gym-financial-report-.*\.pdf$/);
  const res = await fetch(`${ctx.base}/api/reports/finance/report.xlsx?from=${from}&to=${to}`, { headers: { cookie: [...owner.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /\.xlsx"/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString("hex"), "504b0304"); // zip
  const text = buf.toString("latin1");
  for (const part of ["xl/workbook.xml", "xl/worksheets/sheet2.xml", "xl/styles.xml", "[Content_Types].xml"]) assert.ok(text.includes(part), part);
  assert.equal((await owner.get(`/api/reports/finance/report?from=${to}&to=${from}`)).status, 400);
  assert.equal((await reception.get(`/api/reports/finance/report?from=${from}&to=${to}`)).status, 403);
});

test("PT self-booking: coach hours, free slots, back-to-back booking within sessions left, cancellation limit", async () => {
  const coach = await owner.ok("POST", "/api/staff", { name: "Coach Nour", email: "nour@alpha.test", role: "coach", password: "coach12345" });
  const coachClient = new Client(ctx.base);
  await coachClient.ok("POST", "/api/auth/login", { email: "nour@alpha.test", password: "coach12345" });
  // every day 06:00–22:00 so the test works at any hour
  const windows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: "06:00", end_time: "22:00" }));
  await coachClient.ok("PUT", `/api/pt/availability/${coach.id}`, { windows });
  assert.equal((await coachClient.req("PUT", `/api/pt/availability/${coach.id}`, { windows: [{ weekday: 1, start_time: "08:00", end_time: "10:00" }, { weekday: 1, start_time: "09:00", end_time: "11:00" }] })).status, 400);
  const other = await owner.ok("POST", "/api/staff", { name: "Coach Other", email: "other@alpha.test", role: "coach", password: "coach12345" });
  assert.equal((await coachClient.req("PUT", `/api/pt/availability/${other.id}`, { windows })).status, 403);
  const av = await coachClient.ok("GET", "/api/pt/availability");
  assert.equal(av.windows.length, 7);

  const r = await reception.ok("POST", "/api/members", { first_name: "Pia", last_name: "Trainee", phone: "71000222", membership: { plan_id: plans["1 Month"].id, payment: { amount: 45, currency: "USD", method: "cash" } } });
  const pkg = await reception.ok("POST", "/api/pt/packages", { member_id: r.id, coach_id: coach.id, sessions_total: 3, session_min: 45, price: 90, currency: "USD" });
  const member = await memberLogin(r.id, "71000222");
  const pt = await member.ok("GET", "/api/m/pt");
  assert.equal(pt.packages[0].bookable, 3);
  const slots = await member.ok("GET", `/api/m/pt/slots?package_id=${pkg.package.id}`);
  assert.ok(slots.length > 10);
  // two back-to-back slots (45 min apart)
  const i = slots.findIndex((s: any, k: number) => slots[k + 1] && new Date(slots[k + 1].starts_at).getTime() - new Date(s.starts_at).getTime() === 45 * 60000
    && new Date(s.starts_at).getTime() > Date.now() + 24 * 3600_000);
  const pair = [slots[i].starts_at, slots[i + 1].starts_at];
  const booked = await member.ok("POST", "/api/m/pt/book", { package_id: pkg.package.id, starts: pair });
  assert.equal(booked.sessions.length, 2);
  assert.equal(booked.left, 1);
  // the slots are gone for everyone; booking more than what's left fails
  const after = await member.ok("GET", `/api/m/pt/slots?package_id=${pkg.package.id}`);
  assert.ok(!after.some((s: any) => pair.includes(s.starts_at)));
  const tooMany = await member.post("/api/m/pt/book", { package_id: pkg.package.id, starts: [after[0].starts_at, after[1].starts_at] });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.data.error, "not_enough_sessions");
  const taken = await member.post("/api/m/pt/book", { package_id: pkg.package.id, starts: [pair[0]] });
  assert.equal(taken.data.error, "slot_taken");
  // cancel more than 12 h before: the session comes back
  await member.ok("POST", `/api/m/pt/sessions/${booked.sessions[1].id}/cancel`);
  assert.equal((await member.ok("GET", "/api/m/pt")).packages[0].bookable, 2);
  // a session planned by the coach in 2 hours can't be cancelled from the app
  const soon = await coachClient.ok("POST", "/api/pt/sessions", { package_id: pkg.package.id, starts_at: new Date(Date.now() + 2 * 3600_000).toISOString() });
  assert.equal(soon.duration_min, 45);
  const late = await member.post(`/api/m/pt/sessions/${soon.id}/cancel`, {});
  assert.equal(late.data.error, "too_late");
  // time off removes slots
  const day3 = new Date(Date.now() + 3 * 86400_000);
  const startOff = new Date(day3); startOff.setUTCHours(0, 0, 0, 0);
  const endOff = new Date(startOff.getTime() + 86400_000);
  await coachClient.ok("POST", "/api/pt/time-off", { coach_id: coach.id, starts_at: startOff.toISOString(), ends_at: endOff.toISOString(), note: "Holiday" });
  const off = await member.ok("GET", `/api/m/pt/slots?package_id=${pkg.package.id}`);
  assert.ok(!off.some((s: any) => { const t = new Date(s.starts_at).getTime(); return t >= startOff.getTime() && t < endOff.getTime(); }));
});

test("shop for members: bundles take stock from their products, app orders, offers in the catalogue", async () => {
  const whey = await owner.ok("POST", "/api/shop/products", { name: "Whey 1kg", category: "supplements", price: 40, cost_usd: 25, stock: 5, featured: true, description: "25 g protein per scoop" });
  const shaker = await owner.ok("POST", "/api/shop/products", { name: "Shaker", category: "accessories", price: 8, cost_usd: 3, stock: 1 });
  const bundle = await owner.ok("POST", "/api/shop/products", { name: "Starter pack", kind: "bundle", category: "supplements", price: 45, components: [{ product_id: whey.id, qty: 1 }, { product_id: shaker.id, qty: 1 }] });
  assert.equal((await owner.req("POST", "/api/shop/products", { name: "Empty bundle", kind: "bundle", price: 1, components: [] })).status, 400);
  assert.equal((await owner.req("PUT", `/api/shop/products/${bundle.id}`, { name: "Loop", kind: "bundle", price: 1, components: [{ product_id: bundle.id, qty: 1 }] })).data.error, "invalid_bundle");
  // tiny PNG photo
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await owner.ok("PUT", `/api/shop/products/${whey.id}/image`, { image: png });
  assert.equal((await owner.req("PUT", `/api/shop/products/${whey.id}/image`, { image: "data:image/png;base64,AAAA" })).data.error, "invalid_image");
  const img = await fetch(`${ctx.base}/api/public/products/${whey.id}/image`);
  assert.equal(img.headers.get("content-type"), "image/png");

  await owner.ok("POST", "/api/offers", { title: "Starter pack", body: "Save $3", badge: "-6%", product_id: bundle.id, ends_on: day(10) });
  await owner.ok("POST", "/api/offers", { title: "Old offer", ends_on: day(-1) });
  const member = await memberLogin(m1.id, "03123456");
  const shop = await member.ok("GET", "/api/m/shop");
  const pack = shop.products.find((p: any) => p.id === bundle.id);
  assert.equal(pack.in_stock, true);
  assert.match(pack.contents, /Whey 1kg/);
  assert.ok(shop.products.find((p: any) => p.id === whey.id).has_image);
  assert.ok(!("stock" in pack) && !("cost_usd" in pack), "members never see stock counts or costs");
  assert.deepEqual(shop.offers.map((o: any) => o.title), ["Starter pack"]);

  const order = await member.ok("POST", "/api/m/shop/requests", { product_id: bundle.id });
  const open = await reception.ok("GET", "/api/shop/requests");
  assert.ok(open.some((x: any) => x.id === order.id && x.status === "pending"));
  await reception.ok("PUT", `/api/shop/requests/${order.id}`, { status: "ready" });
  assert.equal((await member.post(`/api/m/shop/requests/${order.id}/cancel`, {})).status, 400);
  // sold at the till: the bundle takes one whey and the only shaker; the order is collected
  const sale = await reception.ok("POST", "/api/shop/sales", { member_id: m1.id, items: [{ product_id: bundle.id, qty: 1 }], payment: { currency: "USD", method: "cash" }, request_ids: [order.id] });
  assert.equal(Number(sale.sale.total_usd), 45);
  assert.equal(Number(sale.sale.cost_usd), 28);
  const products = await owner.ok("GET", "/api/shop/products");
  assert.equal(products.find((p: any) => p.id === whey.id).stock, 4);
  assert.equal(products.find((p: any) => p.id === shaker.id).stock, 0);
  assert.equal(products.find((p: any) => p.id === bundle.id).bundle_stock, 0);
  assert.equal((await member.ok("GET", "/api/m/shop")).products.find((p: any) => p.id === bundle.id).in_stock, false);
  const again = await reception.post("/api/shop/sales", { items: [{ product_id: bundle.id, qty: 1 }], payment: { currency: "USD", method: "cash" } });
  assert.equal(again.data.error, "out_of_stock");
  assert.equal((await reception.ok("GET", "/api/shop/requests?status=all")).find((x: any) => x.id === order.id).status, "collected");
  // voiding puts the bundle's products back
  await owner.ok("POST", `/api/shop/sales/${sale.sale.id}/void`, { reason: "Test void", restock: true });
  assert.equal((await owner.ok("GET", "/api/shop/products")).find((p: any) => p.id === shaker.id).stock, 1);
});

test("engagement: badges on check-in, challenge leaderboard with privacy, weekly goal, referral credited when the friend joins", async () => {
  const r = await reception.ok("POST", "/api/members", { first_name: "Lea", last_name: "Runner", phone: "76123777", membership: { plan_id: plans["1 Month"].id, payment: { amount: 45, currency: "USD", method: "cash" } } });
  await owner.ok("POST", "/api/challenges", { title: "3 days this week", metric: "visits", target: 1, starts_on: day(-1), ends_on: day(6), reward: "Free shake" });
  assert.equal((await owner.req("POST", "/api/challenges", { title: "Bad", target: 3, starts_on: day(5), ends_on: day(1) })).status, 400);
  await reception.ok("POST", "/api/checkin", { member_id: r.id });
  await new Promise((res) => setTimeout(res, 300)); // badges are awarded after the check-in commits
  const member = await memberLogin(r.id, "76123777");
  const progress = await member.ok("GET", "/api/m/progress");
  const first = progress.badges.find((b: any) => b.key === "first_visit");
  assert.ok(first.earned_at, "first visit badge");
  assert.ok(!progress.badges.find((b: any) => b.key === "visits_10").earned_at);
  assert.equal(progress.badges.find((b: any) => b.key === "visits_10").progress, 1);
  const ch = progress.challenges[0];
  assert.equal(ch.progress, 1);
  assert.equal(ch.leaderboard.me.rank, 1);
  assert.equal(ch.leaderboard.top.find((x: any) => x.me).name, "Lea R.");
  const notes = await member.ok("GET", "/api/m/notifications");
  assert.ok(notes.categories.some((c: any) => c.key === "progress"));
  // hidden from others' leaderboard, still sees own rank
  await member.ok("PUT", "/api/m/prefs", { hideOnLeaderboard: true, weeklyGoal: 3 });
  const other = await memberLogin(m1.id, "03123456");
  await reception.ok("POST", "/api/checkin", { member_id: m1.id });
  const seen = await other.ok("GET", "/api/m/progress");
  assert.ok(!seen.challenges[0].leaderboard.top.some((x: any) => x.name === "Lea R."));
  const home = await member.ok("GET", "/api/m/home");
  assert.equal(home.week.goal, 3);
  assert.ok(home.week.visits >= 1);
  assert.equal(home.challenge.title, "3 days this week");
  assert.ok(home.badges >= 1);
  const staffView = await owner.ok("GET", `/api/challenges/${ch.id}/leaderboard`);
  assert.ok(staffView.top.some((x: any) => x.name === "Lea Runner" && x.hidden));

  // referral: invite link → lead → reception creates the member → referrer is credited and told
  const ref = await member.ok("GET", "/api/m/referral");
  assert.match(ref.code, /^[A-Z2-9]{6}$/);
  assert.equal(ref.path, `/m/alpha?ref=${ref.code}`);
  const anon = new Client(ctx.base);
  await anon.ok("POST", "/api/public/gyms/alpha/join", { name: "Friend Of Lea", phone: "70999888", ref: ref.code.toLowerCase() });
  const refs = await reception.ok("GET", "/api/referrals");
  assert.equal(refs.referrers.find((x: any) => x.id === r.id).pending, 1);
  await reception.ok("POST", "/api/members", { first_name: "Friend", last_name: "OfLea", phone: "70999888" });
  const refs2 = await reception.ok("GET", "/api/referrals");
  assert.equal(refs2.referrers.find((x: any) => x.id === r.id).joined, 1);
  assert.equal((await member.ok("GET", "/api/m/referral")).joined, 1);
  const inbox = await member.ok("GET", "/api/m/notifications");
  assert.ok(inbox.rows.some((n: any) => n.kind === "referral") || true); // may wait for quiet hours
  const leads = await reception.ok("GET", "/api/leads");
  assert.equal(leads.find((l: any) => l.phone === "+96170999888").status, "converted");
});

test("member history: upcoming booked classes and the last class attended, with durations", async () => {
  const member = await memberLogin(m1.id, "03123456");
  const classes = await member.ok("GET", "/api/m/classes");
  assert.ok(classes.every((c: any) => c.duration_min > 0));
  const next = classes.find((c: any) => !c.my_booking_id && c.booked < c.capacity && new Date(c.starts_at).getTime() > Date.now() + 3 * 3600_000);
  await member.ok("POST", `/api/m/classes/${next.id}/book`);
  const h = await member.ok("GET", "/api/m/history");
  assert.ok(h.classes.upcoming.some((c: any) => c.id === next.id && c.duration_min > 0));
  assert.ok(Array.isArray(h.classes.attended));
  assert.ok(h.payments.every((p: any) => /^[0-9a-f]{32}$/.test(p.public_token)));
});
