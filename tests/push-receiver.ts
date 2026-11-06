/** Receiving side of Web Push, written independently of the server code, to check it end to end. */
import crypto from "node:crypto";

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, len: number) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));

/** Decrypts an aes128gcm push message as a browser would (RFC 8291 / RFC 8188). */
export function decryptForTest(body: Buffer, ua: crypto.ECDH, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const uaPublic = ua.getPublicKey();
  const ecdhSecret = ua.computeSecret(asPublic);
  const ikm = hkdf(auth, ecdhSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--; // padding
  if (plain[end] !== 2) throw new Error("missing last-record delimiter");
  return plain.subarray(0, end);
}

/** Verifies the VAPID header: ES256 JWT signed by the advertised public key, for the right audience. */
export function verifyVapidForTest(header: string, publicKeyB64u: string, audience: string): boolean {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  if (!m || m[2] !== publicKeyB64u) return false;
  const [h, p, s] = m[1].split(".");
  const pub = Buffer.from(publicKeyB64u, "base64url");
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  const ok = crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return ok && claims.aud === audience && claims.exp > Date.now() / 1000 && /^mailto:/.test(claims.sub);
}
