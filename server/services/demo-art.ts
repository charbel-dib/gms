/**
 * Pictures for demo gyms: the shop's products and the app's offers, drawn as SVG.
 *
 * They are made for each demo gym: the shaker, the towel and the offer pictures carry the gym's name and
 * colour, so a gym owner watching a demo sees "their" shop. Real gyms upload photos of their own products.
 * Everything here is drawn by us (no brand, no stock photo), so nothing needs a licence.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function hex(c: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  const n = parseInt(m ? m[1] : "0f5e8c", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** amt < 0 darkens, amt > 0 lightens (towards white) */
function shade(c: string, amt: number) {
  const out = hex(c).map((v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const FONT = `font-family="'Alexandria','Segoe UI','Helvetica Neue',Arial,sans-serif"`;
let uid = 0;
const id = (p: string) => `${p}${++uid}`;

/** horizontal shading that makes a flat shape look round */
function roundShade(gid: string, strength = 1) {
  const a = (v: number) => (v * strength).toFixed(3);
  return `<linearGradient id="${gid}" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity="${a(0.32)}"/>
    <stop offset="0.18" stop-color="#fff" stop-opacity="${a(0.16)}"/>
    <stop offset="0.3" stop-color="#fff" stop-opacity="${a(0.34)}"/>
    <stop offset="0.48" stop-color="#fff" stop-opacity="0"/>
    <stop offset="0.82" stop-color="#000" stop-opacity="${a(0.14)}"/>
    <stop offset="1" stop-color="#000" stop-opacity="${a(0.4)}"/>
  </linearGradient>`;
}

function stage(w: number, h: number, body: string, defs = "", bg = "#ffffff") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs>
  <radialGradient id="bgr" cx="0.5" cy="0.42" r="0.75"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${shade(bg, -0.07)}"/></radialGradient>
  <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#1a1a2a" stop-opacity="0.32"/><stop offset="1" stop-color="#1a1a2a" stop-opacity="0"/></radialGradient>
  ${defs}
</defs>
<rect width="${w}" height="${h}" fill="url(#bgr)"/>
${body}
</svg>`;
}

const floor = (cx: number, y: number, rx: number) => `<ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${Math.round(rx * 0.16)}" fill="url(#shadow)"/>`;

// ---------------------------------------------------------------- products

type Tub = { body: string; lid: string; label: string; ink: string; accent: string; title: string; sub: string; top?: string };

/** a supplement tub standing on the floor, its bottom centre at (cx, bottom) */
function tub(cx: number, bottom: number, w: number, h: number, t: Tub) {
  const g = id("tg"), clip = id("tc");
  const x = cx - w / 2, ry = w * 0.13, lidH = h * 0.17, bodyTop = bottom - h + lidH;
  const labelY = bodyTop + (h - lidH) * 0.16, labelH = (h - lidH) * 0.62;
  // text sized to fit the label (about 0.62 em per capital letter)
  const ts = Math.min(w * 0.135, 56, (w * 0.84) / (t.title.length * 0.66));
  const ss = Math.min(ts * 0.4, 20);
  const pillW = Math.min(w * 0.8, Math.max(w * 0.44, t.sub.length * ss * 0.7 + 28));
  return `
  <defs>${roundShade(g)}<clipPath id="${clip}"><rect x="${x}" y="${bodyTop}" width="${w}" height="${bottom - bodyTop}" rx="${w * 0.04}"/></clipPath></defs>
  ${floor(cx, bottom, w * 0.62)}
  <g clip-path="url(#${clip})">
    <rect x="${x}" y="${bodyTop}" width="${w}" height="${bottom - bodyTop}" fill="${t.body}"/>
    <rect x="${x}" y="${labelY}" width="${w}" height="${labelH}" fill="${t.label}"/>
    <rect x="${x}" y="${labelY + labelH - 10}" width="${w}" height="10" fill="${t.accent}"/>
    <text x="${cx}" y="${labelY + labelH * 0.2}" text-anchor="middle" ${FONT} font-size="${Math.max(10, ss * 0.75)}" font-weight="600" letter-spacing="3" fill="${t.ink}" opacity="0.7">${esc(t.top ?? "SPORT NUTRITION")}</text>
    <text x="${cx}" y="${labelY + labelH * 0.48}" text-anchor="middle" ${FONT} font-size="${ts}" font-weight="800" fill="${t.ink}">${esc(t.title)}</text>
    <rect x="${cx - pillW / 2}" y="${labelY + labelH * 0.58}" width="${pillW}" height="${ss * 1.6}" rx="${ss * 0.8}" fill="${t.accent}"/>
    <text x="${cx}" y="${labelY + labelH * 0.58 + ss * 1.12}" text-anchor="middle" ${FONT} font-size="${ss}" font-weight="700" fill="#fff">${esc(t.sub)}</text>
    <rect x="${x}" y="${bodyTop}" width="${w}" height="${bottom - bodyTop}" fill="url(#${g})"/>
  </g>
  <ellipse cx="${cx}" cy="${bottom}" rx="${w / 2}" ry="${ry * 0.5}" fill="${shade(t.body, -0.35)}" opacity="0.35"/>
  <g>
    <rect x="${x - w * 0.02}" y="${bodyTop - lidH}" width="${w * 1.04}" height="${lidH + 4}" rx="${w * 0.03}" fill="${t.lid}"/>
    ${Array.from({ length: 14 }, (_, i) => `<rect x="${x - w * 0.02 + (i + 0.5) * (w * 1.04 / 14) - 1.5}" y="${bodyTop - lidH + 6}" width="3" height="${lidH - 10}" fill="#000" opacity="0.12"/>`).join("")}
    <rect x="${x - w * 0.02}" y="${bodyTop - lidH}" width="${w * 1.04}" height="${lidH + 4}" rx="${w * 0.03}" fill="url(#${g})"/>
    <ellipse cx="${cx}" cy="${bodyTop - lidH}" rx="${w * 0.52}" ry="${ry * 0.55}" fill="${shade(t.lid, 0.12)}"/>
  </g>`;
}

/** a shaker in the gym's colour with its name on it */
function shaker(cx: number, bottom: number, h: number, brand: string, name: string) {
  const g = id("sg"), clip = id("sc");
  const wTop = h * 0.42, wBot = h * 0.34, lidH = h * 0.2, cupTop = bottom - h + lidH;
  const p = `M${cx - wTop / 2},${cupTop} L${cx + wTop / 2},${cupTop} L${cx + wBot / 2},${bottom - 10} Q${cx + wBot / 2},${bottom} ${cx + wBot / 2 - 10},${bottom} L${cx - wBot / 2 + 10},${bottom} Q${cx - wBot / 2},${bottom} ${cx - wBot / 2},${bottom - 10} Z`;
  const label = name.length > 16 ? name.slice(0, 15) + "…" : name;
  const fs = Math.min(h * 0.075, (wBot * 1.45) / Math.max(4, label.length));
  return `
  <defs>${roundShade(g, 1.1)}<clipPath id="${clip}"><path d="${p}"/></clipPath></defs>
  ${floor(cx, bottom, wTop * 0.7)}
  <g clip-path="url(#${clip})">
    <rect x="${cx - wTop}" y="${cupTop}" width="${wTop * 2}" height="${h}" fill="${brand}" opacity="0.88"/>
    ${[0.25, 0.4, 0.55, 0.7].map((f, i) => `<rect x="${cx + wTop * 0.18}" y="${cupTop + (bottom - cupTop) * f}" width="${i % 2 ? 14 : 24}" height="3" fill="#fff" opacity="0.7"/>`).join("")}
    <text x="${cx - wTop * 0.05}" y="${cupTop + (bottom - cupTop) * 0.62}" text-anchor="middle" ${FONT} font-size="${fs}" font-weight="800" fill="#fff" transform="rotate(-90 ${cx - wTop * 0.05} ${cupTop + (bottom - cupTop) * 0.55})">${esc(label.toUpperCase())}</text>
    <rect x="${cx - wTop}" y="${cupTop}" width="${wTop * 2}" height="${h}" fill="url(#${g})"/>
  </g>
  <rect x="${cx - wTop / 2 - 6}" y="${cupTop - lidH}" width="${wTop + 12}" height="${lidH + 6}" rx="10" fill="#22252b"/>
  <rect x="${cx - wTop / 2 - 6}" y="${cupTop - lidH}" width="${wTop + 12}" height="${lidH + 6}" rx="10" fill="url(#${g})"/>
  <rect x="${cx - wTop * 0.2}" y="${cupTop - lidH - h * 0.06}" width="${wTop * 0.4}" height="${h * 0.08}" rx="8" fill="#2c3038"/>
  <rect x="${cx - wTop / 2 - 6}" y="${cupTop - 6}" width="${wTop + 12}" height="6" fill="#000" opacity="0.25"/>`;
}

function bottle(cx: number, bottom: number, h: number, o: { liquid: string; cap: string; label: string; ink: string; title: string; sub: string; clear?: boolean }) {
  const g = id("bg"), clip = id("bc");
  const w = h * 0.3, neck = w * 0.42, shoulder = bottom - h * 0.68, neckTop = bottom - h * 0.86;
  const p = `M${cx - neck / 2},${neckTop} L${cx + neck / 2},${neckTop} L${cx + neck / 2},${neckTop + h * 0.05} C${cx + w / 2},${shoulder - h * 0.04} ${cx + w / 2},${shoulder} ${cx + w / 2},${shoulder + 10} L${cx + w / 2},${bottom - 14} Q${cx + w / 2},${bottom} ${cx + w / 2 - 14},${bottom} L${cx - w / 2 + 14},${bottom} Q${cx - w / 2},${bottom} ${cx - w / 2},${bottom - 14} L${cx - w / 2},${shoulder + 10} C${cx - w / 2},${shoulder} ${cx - w / 2},${shoulder - h * 0.04} ${cx - neck / 2},${neckTop + h * 0.05} Z`;
  const ly = bottom - h * 0.5, lh = h * 0.26;
  return `
  <defs>${roundShade(g, o.clear ? 0.8 : 1)}<clipPath id="${clip}"><path d="${p}"/></clipPath></defs>
  ${floor(cx, bottom, w * 0.75)}
  <g clip-path="url(#${clip})">
    <rect x="${cx - w}" y="${neckTop}" width="${w * 2}" height="${h}" fill="${o.liquid}" opacity="${o.clear ? 0.35 : 0.95}"/>
    ${o.clear ? `<rect x="${cx - w}" y="${neckTop}" width="${w * 2}" height="${h * 0.12}" fill="#fff" opacity="0.5"/>` : ""}
    <rect x="${cx - w}" y="${ly}" width="${w * 2}" height="${lh}" fill="${o.label}"/>
    <text x="${cx}" y="${ly + lh * 0.48}" text-anchor="middle" ${FONT} font-size="${w * 0.2}" font-weight="800" fill="${o.ink}">${esc(o.title)}</text>
    <text x="${cx}" y="${ly + lh * 0.78}" text-anchor="middle" ${FONT} font-size="${w * 0.11}" font-weight="600" fill="${o.ink}" opacity="0.75">${esc(o.sub)}</text>
    <rect x="${cx - w}" y="${neckTop}" width="${w * 2}" height="${h}" fill="url(#${g})"/>
  </g>
  <path d="${p}" fill="none" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>
  <rect x="${cx - neck / 2 - 4}" y="${bottom - h}" width="${neck + 8}" height="${h * 0.15}" rx="6" fill="${o.cap}"/>
  <rect x="${cx - neck / 2 - 4}" y="${bottom - h}" width="${neck + 8}" height="${h * 0.15}" rx="6" fill="url(#${g})"/>`;
}

function can(cx: number, bottom: number, h: number, body: string, stripe: string, title: string) {
  const g = id("cg"), w = h * 0.36, top = bottom - h, clip = id("cc");
  return `
  <defs>${roundShade(g, 1.2)}<clipPath id="${clip}"><rect x="${cx - w / 2}" y="${top + 14}" width="${w}" height="${h - 24}" rx="10"/></clipPath></defs>
  ${floor(cx, bottom, w * 0.8)}
  <g clip-path="url(#${clip})">
    <rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" fill="${body}"/>
    <path d="M${cx - w},${bottom - h * 0.25} L${cx + w},${top + h * 0.3} L${cx + w},${top + h * 0.42} L${cx - w},${bottom - h * 0.13} Z" fill="${stripe}"/>
    <text x="${cx}" y="${top + h * 0.5}" text-anchor="middle" ${FONT} font-size="${w * 0.24}" font-weight="900" fill="#fff" transform="rotate(-90 ${cx} ${top + h * 0.5})" dy="${w * 0.08}">${esc(title)}</text>
    <rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" fill="url(#${g})"/>
  </g>
  <rect x="${cx - w / 2 + 4}" y="${top}" width="${w - 8}" height="18" rx="8" fill="#c9ced6"/>
  <rect x="${cx - w / 2 + 4}" y="${bottom - 14}" width="${w - 8}" height="14" rx="6" fill="#b7bcc5"/>
  <rect x="${cx - w / 2 + 4}" y="${top}" width="${w - 8}" height="18" rx="8" fill="url(#${g})"/>`;
}

function bar(cx: number, cy: number, w: number, wrap: string, accent: string) {
  const h = w * 0.3, x = cx - w / 2, y = cy - h / 2, g = id("rg");
  const teeth = (x0: number) => Array.from({ length: 9 }, (_, i) => `${x0 + (i % 2 ? 10 : 0)},${y + (i * h) / 8}`).join(" ");
  return `
  <defs><linearGradient id="${g}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></linearGradient></defs>
  ${floor(cx, cy + h * 0.75, w * 0.55)}
  <g transform="rotate(-10 ${cx} ${cy})">
    <polygon points="${teeth(x - 10)} ${x + 30},${y + h} ${x + 30},${y}" fill="${shade(wrap, -0.15)}"/>
    <polygon points="${teeth(x + w)} ${x + w - 30},${y + h} ${x + w - 30},${y}" fill="${shade(wrap, -0.15)}"/>
    <rect x="${x + 20}" y="${y}" width="${w - 40}" height="${h}" rx="8" fill="${wrap}"/>
    <rect x="${x + 20}" y="${y + h * 0.66}" width="${w - 40}" height="${h * 0.12}" fill="${accent}"/>
    <text x="${cx}" y="${y + h * 0.45}" text-anchor="middle" ${FONT} font-size="${h * 0.3}" font-weight="900" fill="#fff">PROTEIN BAR</text>
    <text x="${cx}" y="${y + h * 0.62}" text-anchor="middle" ${FONT} font-size="${h * 0.13}" font-weight="600" fill="#fff" opacity="0.85">20 g protein · low sugar</text>
    <rect x="${x + 20}" y="${y}" width="${w - 40}" height="${h}" rx="8" fill="url(#${g})"/>
  </g>`;
}

function towel(cx: number, bottom: number, w: number, brand: string, name: string) {
  const fold = (y: number, c: string, i: number) => {
    const h = w * 0.2;
    return `<rect x="${cx - w / 2}" y="${y - h}" width="${w}" height="${h}" rx="${h * 0.3}" fill="${c}"/>
      ${Array.from({ length: 18 }, (_, k) => `<rect x="${cx - w / 2 + 18 + k * ((w - 36) / 18)}" y="${y - h + 8}" width="2" height="${h - 16}" fill="#000" opacity="0.06"/>`).join("")}
      <rect x="${cx - w / 2}" y="${y - h * 0.35}" width="${w}" height="${h * 0.35}" rx="${h * 0.2}" fill="#000" opacity="${0.06 + i * 0.02}"/>`;
  };
  const label = name.length > 18 ? name.slice(0, 17) + "…" : name;
  const h = w * 0.2;
  return `
  ${floor(cx, bottom, w * 0.6)}
  ${fold(bottom, shade(brand, -0.12), 2)}
  ${fold(bottom - h * 0.92, brand, 1)}
  ${fold(bottom - h * 1.84, shade(brand, 0.08), 0)}
  <text x="${cx + w * 0.3}" y="${bottom - h * 2.25}" text-anchor="end" ${FONT} font-size="${Math.min(h * 0.32, (w * 0.9) / label.length)}" font-weight="700" fill="#fff" opacity="0.9" letter-spacing="1">${esc(label.toUpperCase())}</text>`;
}

function straps(cx: number, cy: number, w: number) {
  // two cotton straps lying side by side, each with its sewn loop at one end
  const one = (dy: number, rot: number) => {
    const y = cy + dy, x0 = cx - w * 0.46, x1 = cx + w * 0.24, t = w * 0.085;
    return `<g transform="rotate(${rot} ${cx} ${y})">
      <rect x="${x0}" y="${y - t / 2}" width="${x1 - x0}" height="${t}" rx="${t * 0.2}" fill="#23272e"/>
      <ellipse cx="${x1 + w * 0.1}" cy="${y}" rx="${w * 0.12}" ry="${w * 0.075}" fill="none" stroke="#23272e" stroke-width="${t * 0.8}"/>
      <path d="M${x0 + 10},${y - t * 0.28} L${x1 - 6},${y - t * 0.28} M${x0 + 10},${y + t * 0.28} L${x1 - 6},${y + t * 0.28}" stroke="#fff" stroke-opacity="0.3" stroke-width="2" stroke-dasharray="7 6"/>
      <rect x="${x1 - w * 0.07}" y="${y - t * 0.62}" width="${w * 0.07}" height="${t * 1.24}" rx="4" fill="#c93b3b"/>
      <rect x="${x0}" y="${y - t / 2}" width="${x1 - x0}" height="${t * 0.35}" rx="${t * 0.2}" fill="#fff" opacity="0.08"/>
    </g>`;
  };
  return `${floor(cx, cy + w * 0.3, w * 0.55)}${one(-w * 0.07, -5)}${one(w * 0.11, 3)}`;
}

/** SVG for one catalog product, or null when it has no drawing */
export function productArt(productName: string, brand: string, gymName: string): string | null {
  uid = 0;
  const n = productName.toLowerCase();
  const W = 800, B = 690;
  if (n.startsWith("starter pack")) return bundleArt(brand, gymName);
  if (n.includes("whey") && n.includes("chocolate")) return stage(W, W, tub(400, B, 330, 470, { body: "#3b2418", lid: "#24150e", label: "#f3e6d4", ink: "#3b2418", accent: "#8a4b2a", title: "WHEY PROTEIN", sub: "CHOCOLATE · 2 KG" }));
  if (n.includes("whey") && n.includes("vanilla")) return stage(W, W, tub(400, B, 330, 470, { body: "#f4ead2", lid: "#e2d3ae", label: "#ffffff", ink: "#5b4a2a", accent: "#c9a14a", title: "WHEY PROTEIN", sub: "VANILLA · 2 KG" }));
  if (n.includes("creatine")) return stage(W, W, tub(400, B, 260, 300, { body: "#ffffff", lid: "#1d4f91", label: "#eaf1fb", ink: "#1d4f91", accent: "#1d4f91", title: "CREATINE", sub: "300 G · 5 G A DAY" }));
  if (n.includes("pre-workout")) return stage(W, W, tub(400, B, 280, 360, { body: "#17181c", lid: "#e2462c", label: "#17181c", ink: "#ffffff", accent: "#e2462c", title: "PRE-WORKOUT", sub: "30 SERVINGS" }));
  if (n.includes("bcaa")) return stage(W, W, tub(400, B, 280, 340, { body: "#ffffff", lid: "#2f9e5b", label: "#e9f7ef", ink: "#1f6b3e", accent: "#2f9e5b", title: "BCAA", sub: "FRUIT · 400 G" }));
  if (n.includes("mass gainer")) return stage(W, W, tub(400, B, 360, 520, { body: "#111215", lid: "#0b0c0e", label: "#111215", ink: "#e9c46a", accent: "#c8962e", title: "MASS GAINER", sub: "3 KG" }));
  if (n.includes("protein bar")) return stage(W, W, bar(400, 420, 600, "#5a2e1c", "#e9a23b"));
  if (n.includes("water")) return stage(W, W, bottle(400, B, 560, { liquid: "#9fd3f2", cap: "#1f6fbf", label: "#ffffff", ink: "#1f6fbf", title: "WATER", sub: "500 ML", clear: true }));
  if (n.includes("isotonic")) return stage(W, W, bottle(400, B, 560, { liquid: "#f28c28", cap: "#1d1d1f", label: "#ffffff", ink: "#c45d0c", title: "ISOTONIC", sub: "ORANGE · 500 ML" }));
  if (n.includes("energy")) return stage(W, W, can(400, B, 520, "#1b2340", "#b6f23a", "ENERGY"));
  if (n.includes("shaker")) return stage(W, W, shaker(400, B, 560, brand, gymName));
  if (n.includes("towel")) return stage(W, W, towel(400, 600, 520, brand, gymName));
  if (n.includes("strap")) return stage(W, W, straps(400, 330, 560));
  return null;
}

function bundleArt(brand: string, gymName: string) {
  uid = 0;
  return stage(800, 800, `
    ${tub(300, 660, 300, 430, { body: "#3b2418", lid: "#24150e", label: "#f3e6d4", ink: "#3b2418", accent: "#8a4b2a", title: "WHEY PROTEIN", sub: "CHOCOLATE · 2 KG" })}
    ${shaker(580, 690, 440, brand, gymName)}
    ${tub(440, 720, 210, 240, { body: "#ffffff", lid: "#1d4f91", label: "#eaf1fb", ink: "#1d4f91", accent: "#1d4f91", title: "CREATINE", sub: "300 G" })}`);
}

// ---------------------------------------------------------------- offers (wide pictures)

/** the starter pack, on the gym's colour */
export function offerArtStarter(brand: string, gymName: string) {
  uid = 0;
  const W = 1200, H = 700;
  return stage(W, H, `
    <rect width="${W}" height="${H}" fill="url(#ob)"/>
    <circle cx="${W * 0.62}" cy="${H * 0.46}" r="300" fill="#fff" opacity="0.1"/>
    ${tub(470, 600, 270, 390, { body: "#3b2418", lid: "#24150e", label: "#f3e6d4", ink: "#3b2418", accent: "#8a4b2a", title: "WHEY PROTEIN", sub: "CHOCOLATE · 2 KG" })}
    ${shaker(760, 630, 400, shade(brand, 0.25), gymName)}
    ${tub(610, 660, 190, 220, { body: "#ffffff", lid: "#1d4f91", label: "#eaf1fb", ink: "#1d4f91", accent: "#1d4f91", title: "CREATINE", sub: "300 G" })}`,
    `<linearGradient id="ob" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(brand, 0.1)}"/><stop offset="1" stop-color="${shade(brand, -0.3)}"/></linearGradient>`, brand);
}

/** "+7 days": a calendar page with a week marked */
export function offerArtFreeWeek(brand: string) {
  uid = 0;
  const W = 1200, H = 700, x = 400, y = 120, w = 400, h = 440, cell = w / 7;
  const days = Array.from({ length: 35 }, (_, i) => {
    const cx = x + (i % 7) * cell, cy = y + 120 + Math.floor(i / 7) * 60;
    const week = i >= 21 && i < 28;
    return `<rect x="${cx + 6}" y="${cy}" width="${cell - 12}" height="46" rx="12" fill="${week ? brand : "#eef1f5"}"/>
      ${week ? `<text x="${cx + cell / 2}" y="${cy + 31}" text-anchor="middle" ${FONT} font-size="20" font-weight="700" fill="#fff">+1</text>` : ""}`;
  }).join("");
  return stage(W, H, `
    <rect width="${W}" height="${H}" fill="${shade(brand, 0.86)}"/>
    <circle cx="200" cy="560" r="180" fill="${shade(brand, 0.7)}"/>
    <circle cx="1040" cy="140" r="130" fill="${shade(brand, 0.7)}"/>
    ${floor(600, 590, 260)}
    <rect x="${x - 20}" y="${y}" width="${w + 40}" height="${h}" rx="34" fill="#fff"/>
    <rect x="${x - 20}" y="${y}" width="${w + 40}" height="96" rx="34" fill="${brand}"/>
    <rect x="${x - 20}" y="${y + 60}" width="${w + 40}" height="36" fill="${brand}"/>
    <text x="${x + w / 2}" y="${y + 64}" text-anchor="middle" ${FONT} font-size="38" font-weight="800" fill="#fff">+7 DAYS</text>
    ${[x + 70, x + w - 70].map((rx) => `<rect x="${rx - 10}" y="${y - 26}" width="20" height="56" rx="10" fill="#2b2f36"/>`).join("")}
    ${days}`);
}

/** the Saturday bootcamp outdoors at 9:00 */
export function offerArtBootcamp(brand: string) {
  uid = 0;
  const W = 1200, H = 700;
  const kb = (cx: number, by: number, s: number, c: string) => `
    ${floor(cx, by, s * 0.9)}
    <path d="M${cx - s * 0.42},${by - s * 1.05} a${s * 0.42},${s * 0.42} 0 0 1 ${s * 0.84},0" fill="none" stroke="${c}" stroke-width="${s * 0.16}"/>
    <circle cx="${cx}" cy="${by - s * 0.55}" r="${s * 0.6}" fill="${c}"/>
    <ellipse cx="${cx - s * 0.2}" cy="${by - s * 0.75}" rx="${s * 0.16}" ry="${s * 0.1}" fill="#fff" opacity="0.25"/>`;
  const cone = (cx: number, by: number) => `<path d="M${cx - 22},${by} L${cx},${by - 54} L${cx + 22},${by} Z" fill="#f28c28"/><rect x="${cx - 30}" y="${by - 6}" width="60" height="8" rx="3" fill="#d9731b"/><rect x="${cx - 12}" y="${by - 34}" width="24" height="7" fill="#fff" opacity="0.8"/>`;
  return stage(W, H, `
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <circle cx="880" cy="250" r="110" fill="#ffd27a"/>
    <circle cx="880" cy="250" r="160" fill="#ffd27a" opacity="0.25"/>
    <path d="M0,430 C200,360 380,400 560,380 C760,355 960,330 1200,380 L1200,700 L0,700 Z" fill="${shade(brand, -0.15)}" opacity="0.55"/>
    <path d="M0,480 C260,430 520,470 760,450 C960,435 1080,440 1200,460 L1200,700 L0,700 Z" fill="#5fae5b"/>
    <path d="M0,560 C300,530 700,560 1200,540 L1200,700 L0,700 Z" fill="#4c9a48"/>
    ${cone(250, 600)}${cone(420, 585)}${cone(980, 600)}
    ${kb(600, 640, 90, "#23262d")}${kb(760, 650, 70, brand)}
    <text x="80" y="140" ${FONT} font-size="64" font-weight="800" fill="#fff">SAT · 9:00</text>`,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc0f0"/><stop offset="1" stop-color="#d9f0ff"/></linearGradient>`);
}
