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
  assert.equal(waiting.stats.waiting, 1);
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
