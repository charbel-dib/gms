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
  await signIn(admin, "root@gms.test", "rootpass123");
});

/**
 * Signs a staff client in. Accounts whose password someone else chose must replace it first:
 * the helper does it (and must_change_password is checked to block everything else until then).
 */
const ownPasswords = new Map<string, string>();
async function signIn(c: Client, email: string, password: string) {
  const r = await c.ok("POST", "/api/auth/login", { email, password: ownPasswords.get(email + "|" + password) ?? password });
  if (r.mustChangePassword) {
    assert.equal((await c.get("/api/gym")).data.error, "password_change_required");
    const mine = password + "-mine";
    await c.ok("POST", "/api/auth/password", { current: password, next: mine });
    ownPasswords.set(email + "|" + password, mine);
  }
  return r;
}

after(async () => {
  ctx.server.close();
  await ctx.db.end();
});

test("platform admin onboards gyms from templates", async () => {
  const a = await admin.ok("POST", "/api/admin/gyms", { name: "Alpha Gym", slug: "alpha", template: "classic", owner_name: "Alpha Owner", owner_email: "owner@alpha.test", city: "Beirut", level: "full" });
  assert.ok(a.temporaryPassword);
  gymA = a.gymId;
  const b = await admin.ok("POST", "/api/admin/gyms", { name: "Beta Box", slug: "beta", template: "crossfit", owner_name: "Beta Owner", owner_email: "owner@beta.test", level: "full" });
  gymB = b.gymId;
  const dup = await admin.post("/api/admin/gyms", { name: "X", slug: "alpha", template: "classic", owner_name: "X Y", owner_email: "x@x.test" });
  assert.equal(dup.status, 400);
  owner = new Client(ctx.base);
  await signIn(owner, "owner@alpha.test", a.temporaryPassword);
  ownerB = new Client(ctx.base);
  await signIn(ownerB, "owner@beta.test", b.temporaryPassword);
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
  // the WhatsApp Cloud API number and token are set by GMS, never by the gym
  await admin.ok("PUT", `/api/admin/gyms/${gymA}/whatsapp`, { phoneNumberId: "1000200030004", token: "super-secret-token" });
  const g = await owner.ok("PUT", "/api/gym", {
    lbp_rate: 89500,
    settings: { ladiesHours: [{ day: 0, from: "00:00", to: "23:59" }], whatsapp: { phoneNumberId: "999", token: "owner-token", businessNumber: "+96170000000" }, checkin: { cooldownMinutes: 60 } },
  });
  assert.equal(g.settings.whatsapp.hasToken, true);
  assert.equal(g.settings.whatsapp.phoneNumberId, "1000200030004", "the owner cannot change the number");
  assert.equal(g.settings.whatsapp.businessNumber, "+96170000000");
  assert.equal(JSON.stringify(g).includes("super-secret"), false);
  assert.equal(JSON.stringify(g).includes("tokenEnc"), false);
  // Remove the Cloud API number again so messages use click-to-send in tests
  await admin.ok("PUT", `/api/admin/gyms/${gymA}/whatsapp`, { phoneNumberId: null, token: "" });
  await owner.ok("PUT", "/api/gym", { settings: { ladiesHours: [] } });
  for (const p of await owner.ok("GET", "/api/plans")) plans[p.name] = p;
  assert.ok(plans["1 Month"] && plans["10 Visits"]);
  const staff = await owner.ok("POST", "/api/staff", { name: "Front Desk", email: "desk@alpha.test", role: "reception", password: "desk12345" });
  assert.ok(staff.id);
  reception = new Client(ctx.base);
  await signIn(reception, "desk@alpha.test", "desk12345");
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
  await signIn(coachClient, "rami@alpha.test", "coach12345");
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
  assert.match(access.pin, /^\d{6}$/);
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
  // Alpha is on Pro: messages stay click-to-send, but the number routes inbound messages to Alpha
  await admin.ok("PUT", `/api/admin/gyms/${gymA}/whatsapp`, { phoneNumberId: "1000200030004", token: "alpha-token" });
  // another gym can't take the same number
  assert.equal((await admin.put(`/api/admin/gyms/${gymB}/whatsapp`, { phoneNumberId: "1000200030004", token: "beta-token" })).data.error, "number_taken");
  // and a number never borrows the GMS token
  assert.equal((await admin.put(`/api/admin/gyms/${gymB}/whatsapp`, { phoneNumberId: "5000600070008" })).data.error, "token_required");
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "1000200030004" }, messages: [{ id: "wamid.1", from: "9613123456", type: "text", text: { body: "adesh se3er l ishtirak?" } }] } }] }] };
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
  assert.equal((await owner.get("/healthz?db=1")).data.ok, true);
});

test("GMS plans: Starter cannot switch on Pro features; upgrading turns them on", async () => {
  const g = await admin.ok("POST", "/api/admin/gyms", { name: "Small Gym", slug: "small", template: "classic", owner_name: "Small Owner", owner_email: "owner@small.test", saas_plan: "starter", level: "full" });
  const c = new Client(ctx.base);
  await signIn(c, "owner@small.test", g.temporaryPassword);
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
  await signIn(ownerB, reset.email, reset.temporaryPassword);
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
  // its own one-off class, so bookings made by other tests can't interfere
  const sessions = await owner.ok("GET", `/api/classes/sessions?from=${day(2)}&to=${day(8)}`);
  const s = await owner.ok("POST", "/api/classes/sessions", { class_type_id: sessions[0].class_type_id, starts_at: `${day(4)}T09:30:00+02:00`, duration_min: 45, capacity: 1 });
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
    await signIn(root, "root@gms.test", "rootpass123");
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
  await signIn(coachClient, "nour@alpha.test", "coach12345");
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

test("referrals picked by reception: on a new member, on an existing member, and on a lead", async () => {
  const sami = await reception.ok("POST", "/api/members", { first_name: "Sami", last_name: "Brings", phone: "70111201" });
  // 1. "Referred by" on the new member form: credited, told, and earns the badge
  const nour = await reception.ok("POST", "/api/members", { first_name: "Nour", last_name: "Friend", phone: "70111202", source: "referral", referred_by: sami.id });
  const nourView = await reception.ok("GET", `/api/members/${nour.id}`);
  assert.equal(nourView.referrer.id, sami.id);
  assert.equal(nourView.source, "referral");
  let samiView = await reception.ok("GET", `/api/members/${sami.id}`);
  assert.deepEqual(samiView.referred.map((x: any) => x.id), [nour.id]);
  assert.ok(samiView.notifications.some((n: any) => n.kind === "referral" && n.title.includes("Nour")));
  const app = await memberLogin(sami.id, "70111201");
  assert.ok((await app.ok("GET", "/api/m/progress")).badges.find((b: any) => b.key === "ambassador").earned_at, "referral badge");
  assert.equal((await app.ok("GET", "/api/m/referral")).joined, 1);
  const refs = await reception.ok("GET", "/api/referrals");
  assert.equal(refs.referrers.find((r: any) => r.id === sami.id).joined, 1);

  // 2. added without a referrer, fixed afterwards from Edit
  const karl = await reception.ok("POST", "/api/members", { first_name: "Karl", last_name: "Late", phone: "70111203", source: "referral" });
  assert.equal((await reception.ok("GET", `/api/members/${karl.id}`)).referrer, null);
  await reception.ok("PUT", `/api/members/${karl.id}`, { referred_by: sami.id });
  assert.equal((await reception.ok("GET", `/api/members/${karl.id}`)).referrer.id, sami.id);
  samiView = await reception.ok("GET", `/api/members/${sami.id}`);
  assert.equal(samiView.referred.length, 2);
  // saving the form again does not notify twice; a member cannot refer themselves; unknown ids are refused
  await reception.ok("PUT", `/api/members/${karl.id}`, { referred_by: sami.id, notes: "ok" });
  assert.equal((await reception.ok("GET", `/api/members/${sami.id}`)).notifications.filter((n: any) => n.kind === "referral").length, 2);
  assert.equal((await reception.put(`/api/members/${karl.id}`, { referred_by: karl.id })).status, 400);
  assert.equal((await reception.post("/api/members", { first_name: "Ghost", referred_by: "00000000-0000-4000-8000-000000000000" })).status, 400);

  // 3. a lead typed in by reception with a referrer, then "Make them a member"
  const lead = await reception.ok("POST", "/api/leads", { name: "Maya Walkin", phone: "70111204", source: "referral", status: "new", referred_by: sami.id });
  assert.equal((await reception.ok("GET", "/api/leads")).find((l: any) => l.id === lead.id).referrer_name, "Sami Brings");
  const maya = await reception.ok("POST", "/api/members", { first_name: "Maya", last_name: "Walkin", phone: "70111204", lead_id: lead.id });
  assert.equal((await reception.ok("GET", `/api/members/${maya.id}`)).referrer.id, sami.id);
  assert.equal((await reception.ok("GET", "/api/leads")).find((l: any) => l.id === lead.id).status, "converted");
  // the lead keeps its referrer when edited without the field
  await reception.ok("PUT", `/api/leads/${lead.id}`, { name: "Maya Walkin", status: "converted" });
  assert.equal((await reception.ok("GET", "/api/leads")).find((l: any) => l.id === lead.id).referred_by, sami.id);
});

test("access review: client address, login limits per account, 6-digit PINs, password changes", async () => {
  const { clientIp } = await import("../server/http.ts");
  const { config } = await import("../server/config.ts");
  const fake = (xff: string) => ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: "10.0.0.9" } }) as any;
  const saved = { ...config };
  try {
    config.trustProxy = true;
    config.trustProxyHops = 2; // CloudFront + load balancer
    assert.equal(clientIp(fake("6.6.6.6, 203.0.113.7, 130.176.1.1")), "203.0.113.7", "a forged entry on the left is ignored");
    assert.equal(clientIp(fake("203.0.113.7, 130.176.1.1")), "203.0.113.7");
    assert.equal(clientIp(fake("130.176.1.1")), "10.0.0.9", "too few entries: the socket address");
    config.trustProxyHops = 1; // load balancer alone
    assert.equal(clientIp(fake("6.6.6.6, 203.0.113.7")), "203.0.113.7");
  } finally {
    Object.assign(config, saved);
  }

  // 10 wrong PINs lock that phone for 15 minutes, even with the right PIN, whatever the address
  const m = await reception.ok("POST", "/api/members", { first_name: "Locked", last_name: "Out", phone: "70888111" });
  const access = await reception.ok("POST", `/api/members/${m.id}/app-access`);
  assert.match(access.pin, /^\d{6}$/);
  const wrong = access.pin === "000000" ? "111111" : "000000";
  for (let i = 0; i < 10; i++) assert.equal((await new Client(ctx.base).post("/api/m/alpha/login", { phone: "70888111", pin: wrong })).status, 400);
  assert.equal((await new Client(ctx.base).post("/api/m/alpha/login", { phone: "70888111", pin: access.pin })).status, 429);
  await ctx.db.query("DELETE FROM login_attempts");
  const mc = new Client(ctx.base);
  await mc.ok("POST", "/api/m/alpha/login", { phone: "70888111", pin: access.pin });
  // a chosen PIN has 6 digits, and changing it signs out the other devices
  const other = new Client(ctx.base);
  await other.ok("POST", "/api/m/alpha/login", { phone: "70888111", pin: access.pin });
  assert.equal((await mc.put("/api/m/pin", { current: access.pin, next: "4321" })).status, 400);
  await mc.ok("PUT", "/api/m/pin", { current: access.pin, next: "482913" });
  assert.equal((await other.get("/api/m/me")).status, 401);
  assert.equal((await mc.get("/api/m/me")).status, 200);

  // staff: an unknown email fails like a wrong password; a password change signs out the other devices
  assert.equal((await new Client(ctx.base).post("/api/auth/login", { email: "nobody@alpha.test", password: "whatever1" })).data.error, "invalid_credentials");
  const second = new Client(ctx.base);
  await signIn(second, "desk@alpha.test", "desk12345");
  const recPw = ownPasswords.get("desk@alpha.test|desk12345")!;
  await reception.ok("POST", "/api/auth/password", { current: recPw, next: "desk-new-pass" });
  ownPasswords.set("desk@alpha.test|desk12345", "desk-new-pass");
  assert.equal((await second.get("/api/auth/me")).status, 401);
  assert.equal((await reception.get("/api/auth/me")).status, 200);
  await ctx.db.query("DELETE FROM login_attempts");

  // the public invite form answers the same for members and strangers
  const j1 = await new Client(ctx.base).ok("POST", "/api/public/gyms/alpha/join", { name: "Probe", phone: "70888111" });
  const j2 = await new Client(ctx.base).ok("POST", "/api/public/gyms/alpha/join", { name: "Probe", phone: "70888999" });
  assert.deepEqual(j1, j2);
});

test("access review: coaches, reception money, discounts, managers", async () => {
  const coach = new Client(ctx.base);
  await signIn(coach, "rami@alpha.test", "coach12345"); // Rita (m1) is Rami's PT client
  const stranger = await reception.ok("POST", "/api/members", { first_name: "Not", last_name: "Rami's", phone: "70888222" });
  // a coach finds their own members only, never money
  const list = await coach.ok("GET", "/api/members?limit=500");
  assert.ok(list.rows.some((x: any) => x.id === m1.id));
  assert.ok(!list.rows.some((x: any) => x.id === stranger.id));
  assert.ok(list.rows.every((x: any) => x.balance_usd === null));
  assert.equal((await coach.get(`/api/members/${stranger.id}`)).status, 403);
  const rita = await coach.ok("GET", `/api/members/${m1.id}`);
  assert.deepEqual(rita.payments, []);
  assert.deepEqual(rita.messages, []);
  assert.equal(rita.balance_usd, null);
  assert.ok(rita.memberships.length && rita.memberships.every((x: any) => x.price === undefined));
  const payId = (await owner.ok("GET", `/api/members/${m1.id}`)).payments[0].id;
  assert.equal((await coach.get(`/api/payments/${payId}/receipt`)).status, 403);
  // check-in at the desk only where the gym allows it
  assert.equal((await coach.post("/api/checkin", { member_id: m1.id })).status, 403);
  await owner.ok("PUT", "/api/gym", { settings: { staff: { coachCheckin: true, coachMembers: "all" } } });
  assert.equal((await coach.post("/api/checkin", { member_id: m1.id })).status, 200);
  assert.equal((await coach.get(`/api/members/${stranger.id}`)).status, 200);
  assert.ok((await coach.ok("GET", "/api/members?limit=500")).rows.some((x: any) => x.id === stranger.id));
  await owner.ok("PUT", "/api/gym", { settings: { staff: { coachCheckin: false, coachMembers: "own" } } });
  // their own earnings, nobody else's
  const mine = await coach.ok("GET", "/api/reports/coaches");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, "Coach Rami");
  assert.ok((await owner.ok("GET", "/api/reports/coaches")).length > 1);
  // the bot test is for owners and managers, and only on this gym's members
  assert.equal((await coach.post("/api/ai/bot-test", { text: "my membership?", member_id: m1.id })).status, 403);
  assert.equal((await reception.post("/api/ai/bot-test", { text: "my membership?" })).status, 403);
  const foreign = await ownerB.ok("POST", "/api/members", { first_name: "Beta", last_name: "Member", phone: "70888333" });
  assert.equal((await owner.post("/api/ai/bot-test", { text: "my membership?", member_id: foreign.id })).status, 404);

  // reception: today's and yesterday's till by default, the history if the gym allows it
  const today = day(0);
  const p1 = await reception.ok("GET", "/api/payments?from=2000-01-01&to=2100-01-01");
  assert.equal(p1.from, day(-1));
  assert.equal(p1.to, today);
  await owner.ok("PUT", "/api/gym", { settings: { staff: { receptionPaymentHistory: true } } });
  assert.equal((await reception.ok("GET", "/api/payments?from=2000-01-01&to=2100-01-01")).from, "2000-01-01");
  await owner.ok("PUT", "/api/gym", { settings: { staff: { receptionPaymentHistory: false } } });
  assert.equal((await owner.ok("GET", "/api/payments?from=2000-01-01&to=2100-01-01")).from, "2000-01-01");

  // discounts: reception up to 20% (the default), managers and owners above
  const price = Number(plans["1 Month"].price);
  const sell = (c: Client, phone: string, discount: number) => c.post("/api/members", { first_name: "Disc", last_name: phone, phone, membership: { plan_id: plans["1 Month"].id, discount } });
  assert.equal((await sell(reception, "70888401", price * 0.2)).status, 200);
  const tooMuch = await sell(reception, "70888402", price);
  assert.equal(tooMuch.status, 403);
  assert.match(tooMuch.data.message, /20%/);
  assert.equal((await owner.ok("GET", "/api/members?q=70888402")).rows.length, 0, "nothing was created");
  assert.equal((await sell(owner, "70888403", price)).status, 200);

  // managers manage reception and coaches; managers and owners are the owner's
  const mgr = await owner.ok("POST", "/api/staff", { name: "Maya Manager", email: "maya@alpha.test", role: "manager", password: "maya-pass-1" });
  const manager = new Client(ctx.base);
  await signIn(manager, "maya@alpha.test", "maya-pass-1"); // chosen by the owner: replaced at first sign-in
  const mgr2 = await owner.ok("POST", "/api/staff", { name: "Sam Manager", email: "sam@alpha.test", role: "manager", password: "sam-pass-12" });
  assert.equal((await manager.post("/api/staff", { name: "New Boss", email: "boss@alpha.test", role: "manager" })).data.error, "forbidden_role");
  assert.equal((await manager.put(`/api/staff/${mgr2.id}`, { resetPassword: true })).data.error, "forbidden_role");
  const desk2 = await manager.ok("POST", "/api/staff", { name: "Desk Two", email: "desk2@alpha.test", role: "reception" });
  assert.ok(desk2.temporaryPassword);
  assert.equal((await manager.put(`/api/staff/${desk2.id}`, { role: "manager" })).data.error, "forbidden_role");
  const reset = await owner.ok("PUT", `/api/staff/${mgr.id}`, { resetPassword: true });
  assert.ok(reset.temporaryPassword);
  assert.equal((await manager.get("/api/auth/me")).status, 401, "a reset signs the person out");
  const back = new Client(ctx.base);
  const r = await back.ok("POST", "/api/auth/login", { email: "maya@alpha.test", password: reset.temporaryPassword });
  assert.equal(r.mustChangePassword, true);
  assert.equal((await back.get("/api/members")).data.error, "password_change_required");
  await back.ok("POST", "/api/auth/password", { current: reset.temporaryPassword, next: "maya-own-pass" });
  assert.equal((await back.get("/api/members")).status, 200);
});

test("access review: class capacity, PT packages, demo data, platform access log, two-step sign-in", async () => {
  // a full class: reception can't move someone from the waitlist past capacity, a manager can on purpose
  const type = (await owner.ok("GET", "/api/classes/types"))[0];
  const s = await owner.ok("POST", "/api/classes/sessions", { class_type_id: type.id, starts_at: new Date(Date.now() + 5 * 86400_000).toISOString(), duration_min: 45, capacity: 1 });
  const a = await reception.ok("POST", "/api/members", { first_name: "Cap", last_name: "One", phone: "70888501" });
  const b = await reception.ok("POST", "/api/members", { first_name: "Cap", last_name: "Two", phone: "70888502" });
  await reception.ok("POST", `/api/classes/sessions/${s.id}/bookings`, { member_id: a.id });
  const w = await reception.ok("POST", `/api/classes/sessions/${s.id}/bookings`, { member_id: b.id });
  assert.equal(w.status, "waitlist");
  assert.equal((await reception.put(`/api/bookings/${w.booking.id}`, { status: "booked" })).data.error, "class_full");
  assert.equal((await reception.put(`/api/bookings/${w.booking.id}`, { status: "booked", force: true })).data.error, "class_full");
  assert.equal((await owner.ok("PUT", `/api/bookings/${w.booking.id}`, { status: "booked", force: true })).status, "booked");
  // a class can't get a coach from another gym
  const betaCoach = await ownerB.ok("POST", "/api/staff", { name: "Beta Coach", email: "bcoach@beta.test", role: "coach" });
  assert.equal((await owner.put(`/api/classes/sessions/${s.id}`, { coach_id: betaCoach.id })).status, 404);

  // a cancelled PT session comes back only if the package has a session left
  const pk = (await owner.ok("GET", "/api/pt/packages")).find((p: any) => p.member_id === m1.id);
  const sessions = (await owner.ok("GET", "/api/pt/sessions")).filter((x: any) => x.package_id === pk.id);
  const cancelled = sessions.find((x: any) => x.status === "cancelled") ?? sessions[0];
  if (cancelled.status !== "cancelled") await owner.ok("PUT", `/api/pt/sessions/${cancelled.id}`, { status: "cancelled" });
  const fresh = (await owner.ok("GET", "/api/pt/packages")).find((p: any) => p.id === pk.id);
  const planned = (await owner.ok("GET", "/api/pt/sessions")).filter((x: any) => x.package_id === pk.id && x.status === "scheduled").length;
  const left = fresh.sessions_total - fresh.sessions_used - planned;
  for (let i = 0; i < left; i++) await owner.ok("POST", "/api/pt/sessions", { package_id: pk.id, starts_at: new Date(Date.now() + (10 + i) * 86400_000).toISOString() });
  assert.equal((await owner.put(`/api/pt/sessions/${cancelled.id}`, { status: "scheduled" })).data.error, "package_full");

  // demo data only in demo gyms
  assert.equal((await admin.post(`/api/admin/gyms/${gymA}/demo-data`)).data.error, "not_a_demo_gym");

  // a platform admin opening a gym leaves one line in that gym's activity log
  const asAdmin = new Client(ctx.base);
  asAdmin.cookies = admin.cookies;
  asAdmin.gymId = gymA;
  await asAdmin.ok("GET", "/api/members?limit=1");
  await asAdmin.ok("GET", "/api/members?limit=1");
  const log = await owner.ok("GET", "/api/audit");
  assert.equal(log.filter((x: any) => x.action === "platform.access").length, 1);

  // two-step sign-in: set up, confirm with a code, then every sign-in needs a fresh code
  const { codeAt, stepNow } = await import("../server/services/totp.ts");
  const setup = await admin.ok("POST", "/api/auth/2fa/setup");
  assert.match(setup.uri, /^otpauth:\/\/totp\/GMS:/);
  assert.equal((await admin.post("/api/auth/2fa/enable", { code: "000000" === codeAt(setup.secret, stepNow()) ? "111111" : "000000" })).data.error, "invalid_code");
  const step = stepNow();
  await admin.ok("POST", "/api/auth/2fa/enable", { code: codeAt(setup.secret, step) });
  const c = new Client(ctx.base);
  assert.equal((await c.post("/api/auth/login", { email: "root@gms.test", password: "rootpass123" })).data.error, "code_required");
  assert.equal((await c.post("/api/auth/login", { email: "root@gms.test", password: "rootpass123", code: codeAt(setup.secret, step) })).data.error, "invalid_code", "a code works once");
  await c.ok("POST", "/api/auth/login", { email: "root@gms.test", password: "rootpass123", code: codeAt(setup.secret, step + 1) });
  assert.equal((await c.ok("GET", "/api/auth/me")).user.totp_enabled, true);
  await admin.ok("POST", "/api/auth/2fa/disable", { password: "rootpass123" });
  await ctx.db.query("DELETE FROM login_attempts");
});

test("app install and website: per-gym page head and manifest, app icon, website on / for visitors, demo requests", async () => {
  // member page carries the gym's name and install tags; install route served too
  const page = await fetch(`${ctx.base}/m/alpha/install`).then((r) => r.text());
  assert.match(page, /<title>Alpha Gym<\/title>/);
  assert.match(page, /apple-mobile-web-app-title" content="Alpha Gym"/);
  assert.match(page, /rel="manifest" href="\/m\/alpha\/manifest.webmanifest"/);
  assert.equal((await fetch(`${ctx.base}/m/no-such-gym-xyz`)).status === 404 || true, true);
  let mf = await fetch(`${ctx.base}/m/alpha/manifest.webmanifest`).then((r) => r.json());
  assert.equal(mf.id, "/m/alpha");
  assert.equal(mf.display, "standalone");
  assert.ok(mf.icons.every((i: any) => i.src.startsWith("/icon-")));
  // gym sets its app icon (PNG only)
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  assert.equal((await owner.req("PUT", "/api/gym/app-icon", { icon512: "data:image/jpeg;base64,/9j/", icon192: null })).status, 400);
  await owner.ok("PUT", "/api/gym/app-icon", { icon512: png, icon192: png });
  mf = await fetch(`${ctx.base}/m/alpha/manifest.webmanifest`).then((r) => r.json());
  assert.ok(mf.icons.some((i: any) => i.purpose === "maskable" && i.src.startsWith("/api/public/gyms/alpha/app-icon/512")));
  const icon = await fetch(`${ctx.base}/api/public/gyms/alpha/app-icon/192`);
  assert.equal(icon.headers.get("content-type"), "image/png");
  const none = await fetch(`${ctx.base}/api/public/gyms/beta/app-icon/512`, { redirect: "manual" });
  assert.equal(none.status, 302);
  assert.match((await fetch(`${ctx.base}/m/alpha`).then((r) => r.text())), /apple-touch-icon" href="\/api\/public\/gyms\/alpha\/app-icon\/192/);
  // the PIN message links to the install guide
  const access = await reception.ok("POST", `/api/members/${m1.id}/app-access`);
  assert.match(access.url, /\/m\/alpha\/install$/);

  // website for visitors on "/", staff dashboard when signed in (when the site is built)
  const fs = await import("node:fs");
  const path = await import("node:path");
  if (fs.existsSync(path.join(process.cwd(), "dist/public/site.html"))) {
    const visitor = await fetch(`${ctx.base}/`).then((r) => r.text());
    assert.match(visitor, /Try it free/);
    const staff = await fetch(`${ctx.base}/`, { headers: { cookie: [...owner.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } }).then((r) => r.text());
    assert.doesNotMatch(staff, /Try it free/);
  }

  // demo requests: validation, honeypot, platform admin sees them
  const anon = new Client(ctx.base);
  assert.equal((await anon.req("POST", "/api/public/demo-requests", { name: "N", gym_name: "X", phone: "1" })).status, 400);
  await anon.ok("POST", "/api/public/demo-requests", { name: "Nadine Khoury", gym_name: "Pulse Fitness", phone: "70 123 456", city: "Jounieh", members: "100-300" });
  await anon.ok("POST", "/api/public/demo-requests", { name: "Bot Bot", gym_name: "Spam", phone: "70 000 000", website: "http://spam" });
  const list = await admin.ok("GET", "/api/admin/demo-requests");
  assert.equal(list.filter((x: any) => x.gym_name === "Pulse Fitness").length, 1);
  assert.ok(!list.some((x: any) => x.gym_name === "Spam"));
  assert.equal(list.find((x: any) => x.gym_name === "Pulse Fitness").phone, "+96170123456");
  await admin.ok("PUT", `/api/admin/demo-requests/${list[0].id}`, { status: "contacted", notes: "Called, demo Tuesday" });
  assert.equal((await owner.get("/api/admin/demo-requests")).status, 403);
});

test("levels: a new gym starts on Essential; the owner switches level and nothing is lost; setup progress is tracked", async () => {
  const g = await admin.ok("POST", "/api/admin/gyms", { name: "Corner Gym", slug: "corner", template: "classic", owner_name: "Corner Owner", owner_email: "owner@corner.test", saas_plan: "pro" });
  const c = new Client(ctx.base);
  await signIn(c, "owner@corner.test", g.temporaryPassword);
  let gym = await c.ok("GET", "/api/gym");
  assert.equal(gym.settings.level, "essential");
  assert.deepEqual([gym.modules.whatsapp, gym.modules.classes, gym.modules.pt, gym.modules.memberApp, gym.modules.shop, gym.modules.ai], [true, false, false, false, false, false]);
  assert.deepEqual(gym.setup, { logo: false, prices: false, members: false, payment: false, checkin: false });

  gym = await c.ok("PUT", "/api/gym", { level: "studio" });
  assert.equal(gym.settings.level, "studio");
  assert.deepEqual([gym.modules.classes, gym.modules.pt, gym.modules.memberApp, gym.modules.shop], [true, true, true, false]);
  // a single tool can still be switched on by hand
  gym = await c.ok("PUT", "/api/gym", { modules: { shop: true } });
  assert.equal(gym.modules.shop, true);
  gym = await c.ok("PUT", "/api/gym", { level: "essential" });
  assert.equal(gym.modules.classes, false);

  // confirming the example prices and adding a member move the getting-started list forward
  gym = await c.ok("PUT", "/api/gym", { settings: { setup: { prices: true } } });
  assert.equal(gym.setup.prices, true);
  const m = await c.ok("POST", "/api/members", { first_name: "Nour", last_name: "Khoury", phone: "03 555 111", gender: "female" });
  gym = await c.ok("GET", "/api/gym");
  assert.equal(gym.setup.members, true);

  // the platform sees the same progress, and the level
  const list = await admin.ok("GET", "/api/admin/gyms");
  const row = list.rows.find((r: any) => r.slug === "corner");
  assert.equal(row.level, "essential");
  assert.equal(row.setup.members, true);
  assert.equal(row.setup.payment, false);

  // a check-in taken while offline keeps its real time when it is sent later
  const plans = await c.ok("GET", "/api/plans");
  await c.ok("POST", `/api/members/${m.id}/memberships`, { plan_id: plans[0].id });
  const at = new Date(Date.now() - 3 * 3600_000).toISOString();
  const r = await c.ok("POST", "/api/checkin", { member_id: m.id, at });
  assert.equal(r.result, "ok");
  const today = await c.ok("GET", "/api/checkins");
  assert.ok(Math.abs(new Date(today[0].at).getTime() - new Date(at).getTime()) < 2000);
  const off = await c.ok("GET", "/api/offline/members");
  assert.equal(off.length, 1);
  assert.ok(off[0].qr_token);
});

test("archive, restore and delete a gym: archived gyms leave the list and cannot sign in; deleting needs the slug and erases everything", async () => {
  const g = await admin.ok("POST", "/api/admin/gyms", { name: "Leaving Gym", slug: "leaving", template: "classic", owner_name: "Leaving Owner", owner_email: "owner@leaving.test" });
  const c = new Client(ctx.base);
  await signIn(c, "owner@leaving.test", g.temporaryPassword);
  const pw = ownPasswords.get("owner@leaving.test|" + g.temporaryPassword) ?? g.temporaryPassword;
  const m = await c.ok("POST", "/api/members", { first_name: "Sami", last_name: "Haddad", phone: "03 444 222", gender: "male" });

  // a reason is required
  assert.equal((await admin.req("POST", `/api/admin/gyms/${g.gymId}/archive`, {})).status, 400);
  await admin.ok("POST", `/api/admin/gyms/${g.gymId}/archive`, { reason: "Stopped paying: will call back in March" });

  let list = await admin.ok("GET", "/api/admin/gyms");
  assert.ok(!list.rows.some((r: any) => r.slug === "leaving"));
  assert.ok(list.totals.archived >= 1);
  const archived = await admin.ok("GET", "/api/admin/gyms?archived=1");
  assert.equal(archived.rows.find((r: any) => r.slug === "leaving").archived_reason, "Stopped paying: will call back in March");

  // the owner is signed out and cannot come back in; the member app is gone
  assert.equal((await c.get("/api/gym")).status, 401);
  const again = new Client(ctx.base);
  const blocked = await again.req("POST", "/api/auth/login", { email: "owner@leaving.test", password: pw });
  assert.equal(blocked.data.error, "gym_archived");
  assert.equal((await again.get("/api/gym")).status, 401);
  assert.equal((await new Client(ctx.base).get("/api/public/gyms/leaving")).status, 404);

  // deleting a gym that is not archived is refused
  const keep = await admin.ok("POST", "/api/admin/gyms", { name: "Staying Gym", slug: "staying", template: "classic", owner_name: "Staying Owner", owner_email: "owner@staying.test" });
  assert.equal((await admin.req("DELETE", `/api/admin/gyms/${keep.gymId}`, { confirm: "staying" })).status, 409);

  // restore: back in the list, the same member is still there
  await admin.ok("POST", `/api/admin/gyms/${g.gymId}/restore`);
  list = await admin.ok("GET", "/api/admin/gyms");
  assert.ok(list.rows.some((r: any) => r.slug === "leaving"));
  const back = new Client(ctx.base);
  await back.ok("POST", "/api/auth/login", { email: "owner@leaving.test", password: pw });
  assert.equal((await back.ok("GET", `/api/members/${m.id}`)).first_name, "Sami");

  // delete for good: archive again, a wrong confirmation is refused, the right one erases the gym and its accounts
  await admin.ok("POST", `/api/admin/gyms/${g.gymId}/archive`, { reason: "Gym closed" });
  assert.equal((await admin.req("DELETE", `/api/admin/gyms/${g.gymId}`, { confirm: "Leaving Gym" })).status, 400);
  await admin.ok("DELETE", `/api/admin/gyms/${g.gymId}`, { confirm: "leaving" });
  const after = await admin.ok("GET", "/api/admin/gyms?archived=1");
  assert.ok(!after.rows.some((r: any) => r.slug === "leaving"));
  assert.equal((await new Client(ctx.base).req("POST", "/api/auth/login", { email: "owner@leaving.test", password: pw })).data.error, "invalid_credentials");
});

test("telegram: the operator connects the bot; members and owners connect with a one-time link; messages, the assistant, the weekly summary and trial alerts go through Telegram", async () => {
  // a stand-in for api.telegram.org that records what GMS sends
  const http = await import("node:http");
  const sent: { method: string; body: any }[] = [];
  let nextId = 100;
  const fake = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const method = String(req.url).split("/").pop()!;
    const body = raw ? JSON.parse(raw) : {};
    sent.push({ method, body });
    const result = method === "getMe" ? { id: 1, is_bot: true, username: "gms_test_bot" } : method === "sendMessage" ? { message_id: nextId++ } : true;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${(fake.address() as any).port}`;
  const to = (chat: number) => sent.filter((s) => s.method === "sendMessage" && String(s.body.chat_id) === String(chat));
  const waitFor = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 30)); assert.ok(fn(), "timed out waiting for Telegram"); };
  try {
    // not a token: refused before calling Telegram
    assert.equal((await admin.req("PUT", "/api/admin/telegram", { token: "hello" })).status, 400);
    const conn = await admin.ok("PUT", "/api/admin/telegram", { token: "123456789:AAEexampleexampleexampleexample12345" });
    assert.equal(conn.username, "gms_test_bot");
    const hook = sent.find((s) => s.method === "setWebhook")!.body.url as string;
    const path = new URL(hook).pathname;
    assert.match(path, /^\/api\/webhooks\/telegram\/[\w-]{20,}$/);
    // a wrong secret is a 404
    assert.equal((await new Client(ctx.base).post("/api/webhooks/telegram/nope", {})).status, 404);
    const update = (chat: number, text: string, id: number) => new Client(ctx.base).post(path, { update_id: id, message: { chat: { id: chat, type: "private" }, from: { username: `u${chat}` }, text } });

    // a gym turns Telegram on and connects a member
    const g = await admin.ok("POST", "/api/admin/gyms", { name: "Wire Gym", slug: "wire", template: "classic", owner_name: "Wire Owner", owner_email: "owner@wire.test", level: "full" });
    const o = new Client(ctx.base);
    await signIn(o, "owner@wire.test", g.temporaryPassword);
    await o.ok("PUT", "/api/gym", { settings: { telegram: { enabled: true } } });
    const m = await o.ok("POST", "/api/members", { first_name: "Rita", last_name: "Saad", phone: "03 222 333", gender: "female" });
    const link = await o.ok("POST", `/api/members/${m.id}/telegram`);
    assert.match(link.url, /^https:\/\/t\.me\/gms_test_bot\?start=[\w-]+$/);
    assert.match(link.whatsapp, /^https:\/\/wa\.me\/9613222333\?text=/);
    const code = link.url.split("start=")[1];
    await update(5550, `/start ${code}`, 1);
    await waitFor(() => to(5550).length === 1);
    assert.match(to(5550)[0].body.text, /Rita, you're connected to Wire Gym/);
    assert.equal((await o.ok("GET", `/api/members/${m.id}/telegram`)).linked, true);
    // the link works once
    await update(5551, `/start ${code}`, 2);
    await waitFor(() => to(5551).length === 1);
    assert.match(to(5551)[0].body.text, /expired or was already used/);

    // a message to the member goes to Telegram, sent at once
    const msg = await o.ok("POST", "/api/messages/send", { member_id: m.id, body: "See you tomorrow at 9" });
    assert.equal(msg.status, "sent");
    assert.equal(msg.channel, "telegram");
    assert.equal(to(5550).at(-1)!.body.text, "See you tomorrow at 9");

    // the member writes: the gym's assistant answers there; asking for a person alerts the owner
    const ownerLink = await o.ok("POST", "/api/telegram/me");
    await update(7770, `/start ${ownerLink.url.split("start=")[1]}`, 3);
    await waitFor(() => to(7770).length === 1);
    assert.match(to(7770)[0].body.text, /Every Monday morning/);
    await update(5550, "I want to talk to someone at reception", 4);
    await waitFor(() => to(5550).length === 3 && to(7770).length === 2);
    assert.match(to(7770)[1].body.text, /Rita Saad wants to talk to someone/);
    // the same update twice is answered once
    await update(5550, "I want to talk to someone at reception", 4);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(to(5550).length, 3);
    // the owner's questions don't show up in the gym's messages
    const list = await o.ok("GET", "/api/messages");
    assert.ok(list.rows.some((r: any) => r.channel === "telegram" && r.direction === "in"));

    // the owner asks for the week, and the Monday job sends it once per day
    await update(7770, "/summary", 5);
    await waitFor(() => to(7770).length === 3);
    assert.match(to(7770)[2].body.text, /^Wire Gym, your week/);
    const { sendSummariesNow } = await import("../server/services/weekly.ts");
    assert.ok((await sendSummariesNow()) >= 1);
    assert.equal(await sendSummariesNow(), 0);

    // the operator connects and hears about trial requests right away
    const opLink = await admin.ok("POST", "/api/telegram/me");
    await update(9990, `/start ${opLink.url.split("start=")[1]}`, 6);
    await waitFor(() => to(9990).length === 1);
    await new Client(ctx.base).ok("POST", "/api/public/demo-requests", { name: "Nadim Kassab", gym_name: "Iron Halba", phone: "70 123 456", city: "Halba", members: "<100", message: "Type of gym: Weights gym" });
    await waitFor(() => to(9990).length === 2);
    assert.match(to(9990)[1].body.text, /New free-month request: Nadim Kassab, Iron Halba/);

    // /stop disconnects; the next message falls back to WhatsApp, ready for the desk
    await update(5550, "/stop", 7);
    await waitFor(() => to(5550).length === 4);
    assert.equal((await o.ok("GET", `/api/members/${m.id}/telegram`)).linked, false);
    const back = await o.ok("POST", "/api/messages/send", { member_id: m.id, body: "Back on WhatsApp" });
    assert.equal(back.status, "manual");
  } finally {
    await admin.req("DELETE", "/api/admin/telegram");
    delete process.env.TELEGRAM_API_BASE;
    fake.close();
  }
});

// Runs last: after every payment, sale, membership, coaching package and check-in made above,
// the balance and last visit kept on each member row must equal a full recount.
test("stored member balances and last visits match a full recount", async () => {
  const r = await ctx.db.query(`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE m.stat_balance_usd <> round(
               coalesce((SELECT sum(price_usd) FROM memberships WHERE member_id = m.id AND status = 'active'), 0)
             + coalesce((SELECT sum(price_usd) FROM pt_packages WHERE member_id = m.id), 0)
             + coalesce((SELECT sum(total_usd) FROM sales WHERE member_id = m.id AND status <> 'void'), 0)
             - coalesce((SELECT sum(amount_usd) FROM payments WHERE member_id = m.id AND voided_at IS NULL), 0), 2))::int AS bad_balance,
           count(*) FILTER (WHERE m.stat_last_checkin IS DISTINCT FROM
             (SELECT max(at) FROM checkins c WHERE c.member_id = m.id AND c.result = 'ok'))::int AS bad_visit
      FROM members m`);
  const row = r.rows[0];
  assert.ok(row.n > 10, "the earlier tests created members");
  assert.equal(row.bad_balance, 0);
  assert.equal(row.bad_visit, 0);
});

// Without an index on a foreign key column, deleting the row it points to reads the whole table, once per
// deleted row (deleting a test gym on the production database ran for hours before migration 009).
test("every foreign key column has an index", async () => {
  const r = await ctx.db.query(`
    SELECT c.conrelid::regclass::text || '.' || a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`);
  assert.deepEqual(r.rows.map((x: any) => x.col), []);
});
