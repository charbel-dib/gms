/** Unit tests for the pure parts: SQL params, phone numbers, CSV, retrieval, churn model, QR codes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeParam, parseValue } from "../server/db/pg.ts";
import { normalizePhone } from "../server/http.ts";
import { parseCsv, toCsv } from "../server/services/text.ts";
import { Bm25, tokenize } from "../server/ai/rag.ts";
import { trainLogReg, rocAuc, predict, PRIOR } from "../server/ai/churn.ts";
import { qrMatrix } from "../web/shared/qr.ts";
import { parseLooseDate } from "../server/modules/members.ts";
import { reminderText } from "../server/services/whatsapp.ts";

test("pg params and values", () => {
  assert.equal(serializeParam(["a", 'b"c', null])!.toString(), '{"a","b\\"c",NULL}');
  assert.equal(serializeParam({ a: 1 })!.toString(), '{"a":1}');
  assert.equal(serializeParam(true)!.toString(), "t");
  assert.equal(serializeParam(null), null);
  assert.equal(parseValue(20, "42"), 42);
  assert.deepEqual(parseValue(1009, '{a,"b c",NULL}'), ["a", "b c", null]);
  assert.equal((parseValue(1184, "2026-11-05 21:54:06.518+00") as Date).toISOString(), "2026-11-05T21:54:06.518Z");
  assert.equal((parseValue(1184, "2026-11-05 23:54:06+02") as Date).toISOString(), "2026-11-05T21:54:06.000Z");
});

test("Lebanese phone numbers normalise to E.164", () => {
  assert.equal(normalizePhone("03 123 456"), "+9613123456");
  assert.equal(normalizePhone("71-234-567"), "+96171234567");
  assert.equal(normalizePhone("00961 76 123 456"), "+96176123456");
  assert.equal(normalizePhone("+33 6 12 34 56 78"), "+33612345678");
  assert.equal(normalizePhone("961 81 000111"), "+96181000111");
});

test("CSV: quotes, semicolons, BOM, formula injection", () => {
  assert.deepEqual(parseCsv('﻿a;b\n"x;1";"say ""hi"""\n'), [["a", "b"], ["x;1", 'say "hi"']]);
  assert.match(toCsv([{ name: "=HYPERLINK(1)", n: -5 }]), /'=HYPERLINK\(1\),-5/);
  assert.equal(parseLooseDate("31/12/2026"), "2026-12-31");
  assert.equal(parseLooseDate("2026-1-5"), "2026-01-05");
  assert.equal(parseLooseDate("5/1/27"), "2027-01-05");
  assert.equal(parseLooseDate("soon"), null);
});

test("retrieval understands Arabic, Arabizi and English", () => {
  assert.ok(tokenize("قدّيش الأسعار").includes("price"));
  const b = new Bm25([
    { id: "prices", title: "Membership prices", body: "1 Month $45" },
    { id: "hours", title: "Opening hours", body: "Monday 06:00 – 23:00" },
    { id: "freeze", title: "Freezing a membership", body: "Up to 10 days" },
  ]);
  assert.equal(b.search("adesh l ishtirak")[0].doc.id, "prices");
  assert.equal(b.search("emta dawam?")[0].doc.id, "hours");
  assert.equal(b.search("bade jamed, msefer")[0].doc.id, "freeze");
  assert.equal(b.search("شو دوامكن")[0].doc.id, "hours");
});

test("logistic regression learns a separable signal; AUC is computed correctly", () => {
  assert.equal(rocAuc([{ p: 0.9, y: 1 }, { p: 0.1, y: 0 }]), 1);
  assert.equal(rocAuc([{ p: 0.1, y: 1 }, { p: 0.9, y: 0 }]), 0);
  const X: number[][] = [];
  const y: number[] = [];
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i++) {
    const absent = r() * 40;
    X.push([absent, r() * 10, 0, 30, 6, 1, 0, 0, 0, 30]);
    y.push(absent + r() * 10 > 25 ? 1 : 0);
  }
  const { model, metrics } = trainLogReg(X, y);
  assert.ok((metrics.auc ?? 0) > 0.85, `auc ${metrics.auc}`);
  assert.ok(model.weights[0] > 0, "absence increases risk");
});

test("expert prior ranks a disengaged member above an engaged one", () => {
  const base = { visits_last_14: 6, visit_trend: 0, days_to_expiry: 30, tenure_months: 8, renewals: 2, has_pt: 0, unpaid_balance: 0, no_show_rate: 0, plan_length_days: 30 };
  const engaged = predict(PRIOR, { ...base, days_since_last_visit: 1 }).score;
  const gone = predict(PRIOR, { ...base, days_since_last_visit: 25, visits_last_14: 0, visit_trend: -6, days_to_expiry: 4 }).score;
  assert.ok(gone > 0.7 && engaged < 0.4, `${gone} vs ${engaged}`);
});

test("QR codes have the right size and finder patterns", () => {
  const m = qrMatrix("GMS:3f9a1c2e4b5d6e7f8a9b0c1d");
  assert.equal(m.length, 29); // version 3
  const finder = (x: number, y: number) => m[y][x] && m[y][x + 6] && m[y + 6][x] && m[y + 3][x + 3] && !m[y + 1][x + 1];
  assert.ok(finder(0, 0) && finder(22, 0) && finder(0, 22));
});

test("reminder texts in English and Lebanese Arabic", () => {
  const v = { name: "Rita", plan: "1 Month", gym: "Pulse", date: "2026-12-01", days: 7 };
  assert.match(reminderText("en", "before", v), /7 days left/);
  assert.match(reminderText("ar", "after", v), /اشتقنالك/);
  assert.equal(reminderText("en", "before", v, "Yo {name}, {days}d"), "Yo Rita, 7d");
});

import cryptoNode from "node:crypto";
import { quietDelayMinutes } from "../server/services/notify.ts";
import { encryptPayload } from "../server/services/webpush.ts";
import { decryptForTest } from "./push-receiver.ts";

test("quiet hours: crossing midnight, same-day ranges, outside", () => {
  assert.equal(quietDelayMinutes(23 * 60, "22:00", "08:00"), 9 * 60);
  assert.equal(quietDelayMinutes(2 * 60 + 30, "22:00", "08:00"), 5 * 60 + 30);
  assert.equal(quietDelayMinutes(12 * 60, "22:00", "08:00"), 0);
  assert.equal(quietDelayMinutes(13 * 60, "12:00", "14:00"), 60);
  assert.equal(quietDelayMinutes(14 * 60, "12:00", "14:00"), 0);
  assert.equal(quietDelayMinutes(10, "08:00", "08:00"), 0);
});

test("web push encryption decrypts with the browser's keys (RFC 8291)", () => {
  const ua = cryptoNode.createECDH("prime256v1");
  ua.generateKeys();
  const auth = cryptoNode.randomBytes(16);
  const msg = Buffer.from(JSON.stringify({ title: "مرحبا 💪", body: "x".repeat(3000) }));
  const body = encryptPayload(msg, ua.getPublicKey().toString("base64url"), auth.toString("base64url"));
  assert.deepEqual(decryptForTest(body, ua, auth), msg);
  const wrong = cryptoNode.randomBytes(16);
  assert.throws(() => decryptForTest(body, ua, wrong));
});
