/**
 * Shop: supplements, drinks, accessories sold at reception.
 * Stock is tracked per product with a movement log; each sale creates a payment
 * (so it appears in receipts, cash drawer and reports) or goes on the member's account.
 */
import { z } from "zod";
import { db, one, many, audit, nextCounter, type Queryable } from "../db/index.ts";
import { requireStaff } from "../auth.ts";
import { bad, notFound, zCurrency, zDate, zId, zMethod, type Router } from "../http.ts";
import { gymRate, gymToday, toUsd } from "../services/money.ts";
import { getOverview, recordPayment } from "./members.ts";
import { parseImage } from "./community.ts";
import { assertDiscountAllowed, clampForReception } from "../services/access.ts";

export const PRODUCT_CATEGORIES = ["supplements", "drinks", "snacks", "accessories", "apparel", "other"] as const;

const productBase = z.object({
  name: z.string().trim().min(1).max(100),
  name_ar: z.string().trim().max(100).nullable().optional(),
  category: z.enum(PRODUCT_CATEGORIES).default("supplements"),
  brand: z.string().trim().max(60).nullable().optional(),
  barcode: z.string().trim().max(40).nullable().optional().transform((v) => v || null),
  price: z.coerce.number().min(0).max(1e10),
  currency: zCurrency.default("USD"),
  cost_usd: z.coerce.number().min(0).max(1e8).default(0),
  low_stock_at: z.coerce.number().int().min(0).max(100000).default(5),
  track_stock: z.boolean().default(true),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null)),
  active: z.boolean().default(true),
  description: z.string().trim().max(1000).nullable().optional(),
  in_app: z.boolean().default(true),
  featured: z.boolean().default(false),
  kind: z.enum(["item", "bundle"]).default("item"),
  components: z.array(z.object({ product_id: z.string().uuid(), qty: z.coerce.number().int().min(1).max(50) })).max(12).default([]),
});
const bundleRule = (p: { kind: string; components: unknown[] }) => p.kind === "item" || p.components.length >= 1;
const bundleMsg = { message: "A bundle needs at least one product", path: ["components"] };
const productSchema = productBase.refine(bundleRule, bundleMsg);

/** Product columns sent to browsers (never the image bytes). */
export const PRODUCT_COLS = `p.id, p.gym_id, p.name, p.name_ar, p.category, p.brand, p.barcode, p.price, p.currency, p.cost_usd, p.stock, p.low_stock_at, p.track_stock,
  p.expires_on, p.active, p.created_at, p.description, p.in_app, p.featured, p.kind, p.components, (p.image IS NOT NULL) AS has_image`;

/** A bundle is made of plain products of the same gym. */
async function checkComponents(q: Queryable, gymId: string, selfId: string | null, comps: { product_id: string; qty: number }[]) {
  if (!comps.length) return [];
  const ids = [...new Set(comps.map((c) => c.product_id))];
  if (selfId && ids.includes(selfId)) throw bad("invalid_bundle", "A bundle cannot contain itself");
  const rows = await many(q, "SELECT id, kind FROM products WHERE gym_id = $1 AND id = ANY($2::uuid[])", [gymId, ids]);
  if (rows.length !== ids.length) throw notFound("bundle product");
  if (rows.some((r) => r.kind === "bundle")) throw bad("invalid_bundle", "A bundle can only contain single products");
  const merged = new Map<string, number>();
  for (const c of comps) merged.set(c.product_id, (merged.get(c.product_id) ?? 0) + c.qty);
  return [...merged].map(([product_id, qty]) => ({ product_id, qty }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function lowStock(q: Queryable, gymId: string) {
  return many(q, `SELECT id, name, stock, low_stock_at FROM products WHERE gym_id = $1 AND active AND track_stock AND kind = 'item' AND stock <= low_stock_at ORDER BY stock, name LIMIT 30`, [gymId]);
}

interface SaleInput {
  request_ids?: string[];
  member_id?: string | null;
  customer_name?: string | null;
  items: { product_id: string; qty: number }[];
  discount_usd?: number;
  on_account?: boolean;
  note?: string | null;
  payment?: { currency: "USD" | "LBP"; method: string; reference?: string | null } | null;
}

/** Creates a sale atomically: locks products, checks stock, decrements it, records the payment. */
export async function createSale(q: Queryable, gymId: string, userId: string | null, input: SaleInput, actor: { role: string; gymId: string } | null = null) {
  if (!input.items.length) throw bad("empty_cart", "Add at least one product");
  if (input.on_account && !input.member_id) throw bad("member_required", "Choose a member to put the sale on their account");
  if (!input.on_account && !input.payment) throw bad("payment_required", "Choose how the customer pays");
  if (input.member_id) await getOverview(q, gymId, input.member_id);

  // merge duplicate lines, lock products (and the products inside bundles) in a stable order (no deadlocks between two tills)
  const qty = new Map<string, number>();
  for (const it of input.items) qty.set(it.product_id, (qty.get(it.product_id) ?? 0) + it.qty);
  const ids = [...qty.keys()].sort();
  const shapes = await many(q, "SELECT id, kind, components FROM products WHERE gym_id = $1 AND id = ANY($2::uuid[])", [gymId, ids]);
  if (shapes.length !== ids.length) throw notFound("product");
  const allIds = [...new Set([...ids, ...shapes.flatMap((s) => (s.kind === "bundle" ? (s.components ?? []).map((c: any) => c.product_id) : []))])].sort();
  const locked = await many(q, `SELECT * FROM products WHERE gym_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [gymId, allIds]);
  const byId = new Map(locked.map((p) => [p.id, p]));
  const products = ids.map((id) => byId.get(id)!).filter(Boolean);

  const rate = await gymRate(q, gymId);
  // stock needed per physical product, whether sold alone or inside a bundle
  const need = new Map<string, number>();
  const lines = products.map((p) => {
    const n = qty.get(p.id)!;
    if (!p.active) throw bad("product_inactive", `${p.name} is no longer on sale`);
    let costUnit = Number(p.cost_usd);
    if (p.kind === "bundle") {
      costUnit = 0;
      for (const c of p.components ?? []) {
        const cp = byId.get(c.product_id);
        if (!cp) throw notFound("bundle product");
        costUnit += Number(cp.cost_usd) * c.qty;
        if (cp.track_stock) need.set(cp.id, (need.get(cp.id) ?? 0) + c.qty * n);
      }
    } else if (p.track_stock) need.set(p.id, (need.get(p.id) ?? 0) + n);
    return { p, n, lineUsd: round2(toUsd(Number(p.price), p.currency, rate) * n), costUsd: round2(costUnit * n), unitCost: round2(costUnit) };
  });
  for (const [id, n] of need) {
    const p = byId.get(id)!;
    if (p.stock < n) throw bad("out_of_stock", `Only ${p.stock} × ${p.name} left in stock`);
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.lineUsd, 0));
  const discount = Math.min(round2(input.discount_usd ?? 0), subtotal);
  await assertDiscountAllowed(q, actor, discount, subtotal);
  const total = round2(subtotal - discount);
  const cost = round2(lines.reduce((s, l) => s + l.costUsd, 0));
  const saleNo = await nextCounter(q, gymId, "sale", 1);

  const sale = await one(
    q,
    `INSERT INTO sales (gym_id, sale_no, member_id, customer_name, subtotal_usd, discount_usd, total_usd, cost_usd, lbp_rate, status, note, sold_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [gymId, saleNo, input.member_id ?? null, input.customer_name ?? null, subtotal, discount, total, cost, rate, input.on_account ? "on_account" : "paid", input.note ?? null, userId],
  );
  for (const l of lines) {
    await q.query(
      `INSERT INTO sale_items (sale_id, product_id, name, qty, unit_price, currency, line_total_usd, unit_cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sale!.id, l.p.id, l.p.name, l.n, l.p.price, l.p.currency, l.lineUsd, l.unitCost],
    );
  }
  for (const [id, n] of need) {
    const p = byId.get(id)!;
    await q.query("UPDATE products SET stock = stock - $2 WHERE id = $1", [id, n]);
    const viaBundle = lines.filter((l) => l.p.kind === "bundle" && (l.p.components ?? []).some((c: any) => c.product_id === id)).map((l) => l.p.name);
    await q.query(`INSERT INTO stock_moves (gym_id, product_id, qty, kind, sale_id, note, by_user) VALUES ($1,$2,$3,'sale',$4,$5,$6)`,
      [gymId, id, -n, sale!.id, viaBundle.length ? `In bundle: ${viaBundle.join(", ")}` : null, userId]);
    void p;
  }
  // orders placed from the member app and collected now
  if (input.request_ids?.length) {
    await q.query(`UPDATE product_requests SET status = 'collected', sale_id = $3, updated_at = now()
                    WHERE gym_id = $1 AND id = ANY($2::uuid[]) AND status IN ('pending','ready')`, [gymId, input.request_ids, sale!.id]);
  }

  let payment = null;
  if (!input.on_account && total > 0) {
    const pay = input.payment!;
    // lira cash is rounded to the nearest 1,000 LBP; the USD value stays exact so no cents are left owing
    const amount = pay.currency === "LBP" ? Math.max(1000, Math.round((total * rate) / 1000) * 1000) : total;
    payment = await recordPayment(q, gymId, userId, {
      member_id: input.member_id ?? null, sale_id: sale!.id, amount, currency: pay.currency, method: pay.method,
      reference: pay.reference ?? null, note: `Shop sale #${saleNo}`, amount_usd: total,
    });
  }
  await audit(q, gymId, userId, "shop.sale", "sale", sale!.id, { total, items: lines.length, on_account: !!input.on_account });
  return { sale, payment, lines: lines.map((l) => ({ name: l.p.name, qty: l.n, line_total_usd: l.lineUsd })) };
}

export function registerShop(r: Router) {
  // ---------- products ----------
  r.get("/api/shop/products", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const vals: unknown[] = [u.gymId];
    const where = ["p.gym_id = $1"];
    if (ctx.query.get("all") !== "1") where.push("p.active");
    const q = ctx.query.get("q")?.trim();
    if (q) {
      vals.push(`%${q}%`, q);
      where.push(`(p.name ILIKE $${vals.length - 1} OR p.brand ILIKE $${vals.length - 1} OR p.name_ar ILIKE $${vals.length - 1} OR p.barcode = $${vals.length})`);
    }
    return many(db, `
      SELECT ${PRODUCT_COLS},
             CASE WHEN p.kind = 'bundle' THEN (SELECT min(floor(c.stock / greatest((x->>'qty')::int, 1)))::int FROM jsonb_array_elements(p.components) x
                                                 JOIN products c ON c.id = (x->>'product_id')::uuid AND c.track_stock) END AS bundle_stock,
             (SELECT string_agg((x->>'qty') || ' × ' || c.name, ', ') FROM jsonb_array_elements(p.components) x JOIN products c ON c.id = (x->>'product_id')::uuid) AS contents,
             (SELECT coalesce(sum(si.qty), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
               WHERE si.product_id = p.id AND s.status <> 'void' AND s.sold_at > now() - interval '30 days')::int AS sold_30d
        FROM products p WHERE ${where.join(" AND ")}
       ORDER BY p.active DESC, p.category, p.name`, vals);
  });

  r.get("/api/shop/barcode/:code", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const p = await one(db, `SELECT ${PRODUCT_COLS} FROM products p WHERE p.gym_id = $1 AND p.barcode = $2 AND p.active`, [u.gymId, ctx.params.code.trim()]);
    if (!p) throw notFound("product with this barcode");
    return p;
  });

  r.post("/api/shop/products", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(productBase.extend({ stock: z.coerce.number().int().min(0).max(1000000).default(0) }).refine(bundleRule, bundleMsg));
    return db.tx(async (q) => {
      const components = b.kind === "bundle" ? await checkComponents(q, u.gymId, null, b.components) : [];
      const bundle = b.kind === "bundle";
      const p = await one(q, `INSERT INTO products (gym_id, name, name_ar, category, brand, barcode, price, currency, cost_usd, stock, low_stock_at, track_stock, expires_on, active, description, in_app, featured, kind, components)
                              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id, name, kind, stock, price, currency`,
        [u.gymId, b.name, b.name_ar ?? null, b.category, b.brand ?? null, b.barcode, b.price, b.currency, bundle ? 0 : b.cost_usd, bundle ? 0 : b.stock, b.low_stock_at, bundle ? false : b.track_stock,
          b.expires_on ?? null, b.active, b.description ?? null, b.in_app, b.featured, b.kind, JSON.stringify(components)]);
      if (!bundle && b.stock > 0) await q.query(`INSERT INTO stock_moves (gym_id, product_id, qty, kind, unit_cost_usd, by_user) VALUES ($1,$2,$3,'initial',$4,$5)`, [u.gymId, p!.id, b.stock, b.cost_usd, u.id]);
      await audit(q, u.gymId, u.id, "shop.product.create", "product", p!.id);
      return p;
    });
  });

  r.put("/api/shop/products/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(productSchema);
    const id = zId.parse(ctx.params.id);
    const bundle = b.kind === "bundle";
    const components = bundle ? await checkComponents(db, u.gymId, id, b.components) : [];
    const current = await one(db, "SELECT kind, stock FROM products WHERE id = $1 AND gym_id = $2", [id, u.gymId]);
    if (!current) throw notFound("product");
    if (bundle && current.kind === "item" && current.stock > 0) throw bad("has_stock", "This product still has stock: create the bundle as a new product");
    if (!bundle && (await one(db, "SELECT 1 FROM products WHERE gym_id = $1 AND kind = 'bundle' AND components @> $2::jsonb", [u.gymId, JSON.stringify([{ product_id: id }])])) && !b.active) {
      throw bad("in_bundle", "This product is part of a bundle: remove it from the bundle first");
    }
    const p = await one(db, `UPDATE products SET name=$3, name_ar=$4, category=$5, brand=$6, barcode=$7, price=$8, currency=$9, cost_usd=$10, low_stock_at=$11, track_stock=$12, expires_on=$13, active=$14,
                                    description=$15, in_app=$16, featured=$17, kind=$18, components=$19
                              WHERE id = $1 AND gym_id = $2 RETURNING id, name, kind`,
      [id, u.gymId, b.name, b.name_ar ?? null, b.category, b.brand ?? null, b.barcode, b.price, b.currency, bundle ? 0 : b.cost_usd, b.low_stock_at, bundle ? false : b.track_stock,
        b.expires_on ?? null, b.active, b.description ?? null, b.in_app, b.featured, b.kind, JSON.stringify(components)]);
    if (!p) throw notFound("product");
    await audit(db, u.gymId, u.id, "shop.product.update", "product", p.id);
    return p;
  });

  /** Product photo shown in the member app (PNG/JPEG/WebP data URL, resized in the browser). */
  r.put("/api/shop/products/:id/image", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ image: z.string().max(900_000).nullable() }));
    const img = b.image ? parseImage(b.image) : null;
    const p = await one(db, "UPDATE products SET image = $3, image_mime = $4 WHERE id = $1 AND gym_id = $2 RETURNING id", [zId.parse(ctx.params.id), u.gymId, img?.buf ?? null, img?.mime ?? null]);
    if (!p) throw notFound("product");
    return { ok: true };
  });

  /** Restock (delivery received) or adjust (count after inventory, broken, expired, given away). */
  r.post("/api/shop/products/:id/stock", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({
      kind: z.enum(["restock", "adjust"]),
      qty: z.coerce.number().int().min(-100000).max(100000).refine((n) => n !== 0, "quantity cannot be 0"),
      unit_cost_usd: z.coerce.number().min(0).max(1e8).nullable().optional(),
      expires_on: zDate.nullable().optional(),
      note: z.string().max(200).nullable().optional(),
    }));
    if (b.kind === "restock" && b.qty < 0) throw bad("invalid_qty", "A delivery adds stock: use a positive quantity");
    return db.tx(async (q) => {
      const p = await one(q, "SELECT id, stock, cost_usd, kind FROM products WHERE id = $1 AND gym_id = $2 FOR UPDATE", [zId.parse(ctx.params.id), u.gymId]);
      if (!p) throw notFound("product");
      if (p.kind === "bundle") throw bad("bundle_stock", "A bundle has no stock of its own: restock the products inside it");
      if (p.stock + b.qty < 0) throw bad("negative_stock", `Stock cannot go below 0 (now ${p.stock})`);
      // weighted average purchase cost, so margins stay right when supplier prices change
      let cost = Number(p.cost_usd);
      if (b.kind === "restock" && b.unit_cost_usd != null) {
        const before = Math.max(p.stock, 0);
        cost = before + b.qty > 0 ? round2((before * cost + b.qty * b.unit_cost_usd) / (before + b.qty)) : b.unit_cost_usd;
      }
      const row = await one(q, `UPDATE products SET stock = stock + $2, cost_usd = $3, expires_on = coalesce($4, expires_on) WHERE id = $1 RETURNING id, stock, cost_usd, expires_on`, [p.id, b.qty, cost, b.expires_on ?? null]);
      await q.query(`INSERT INTO stock_moves (gym_id, product_id, qty, kind, unit_cost_usd, note, by_user) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [u.gymId, p.id, b.qty, b.kind, b.unit_cost_usd ?? null, b.note ?? null, u.id]);
      await audit(q, u.gymId, u.id, `shop.stock.${b.kind}`, "product", p.id, { qty: b.qty, note: b.note });
      return row;
    });
  });

  r.get("/api/shop/products/:id/moves", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    return many(db, `SELECT sm.*, us.name AS by_name, s.sale_no FROM stock_moves sm LEFT JOIN users us ON us.id = sm.by_user LEFT JOIN sales s ON s.id = sm.sale_id
                      WHERE sm.product_id = $1 AND sm.gym_id = $2 ORDER BY sm.at DESC LIMIT 100`, [zId.parse(ctx.params.id), u.gymId]);
  });

  // ---------- sales ----------
  r.post("/api/shop/sales", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(z.object({
      member_id: zId.nullable().optional(),
      customer_name: z.string().trim().max(80).nullable().optional(),
      items: z.array(z.object({ product_id: zId, qty: z.coerce.number().int().min(1).max(1000) })).min(1).max(50),
      discount_usd: z.coerce.number().min(0).max(1e8).default(0),
      on_account: z.boolean().default(false),
      note: z.string().max(200).nullable().optional(),
      payment: z.object({ currency: zCurrency, method: zMethod, reference: z.string().max(80).nullable().optional() }).nullable().optional(),
      request_ids: z.array(zId).max(20).optional(),
    }));
    return db.tx((q) => createSale(q, u.gymId, u.id, b, u));
  });

  r.get("/api/shop/sales", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const today = await gymToday(db, u.gymId);
    // reception sees today's and yesterday's sales unless the gym lets it see the history
    const { from, to } = await clampForReception(db, u, zDate.parse(ctx.query.get("from") ?? today), zDate.parse(ctx.query.get("to") ?? today));
    return many(db, `
      SELECT s.*, m.first_name, m.last_name, m.code, us.name AS sold_by_name,
             (SELECT string_agg(si.qty || ' × ' || si.name, ', ' ORDER BY si.name) FROM sale_items si WHERE si.sale_id = s.id) AS summary,
             (SELECT p.id FROM payments p WHERE p.sale_id = s.id ORDER BY p.paid_at LIMIT 1) AS payment_id,
             (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.paid_at LIMIT 1) AS method
        FROM sales s JOIN gyms g ON g.id = s.gym_id
        LEFT JOIN members m ON m.id = s.member_id LEFT JOIN users us ON us.id = s.sold_by
       WHERE s.gym_id = $1 AND (s.sold_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3
       ORDER BY s.sold_at DESC LIMIT 500`, [u.gymId, from, to]);
  });

  r.post("/api/shop/sales/:id/void", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ reason: z.string().trim().min(3).max(200), restock: z.boolean().default(true) }));
    return db.tx(async (q) => {
      const s = await one(q, "SELECT * FROM sales WHERE id = $1 AND gym_id = $2 FOR UPDATE", [zId.parse(ctx.params.id), u.gymId]);
      if (!s) throw notFound("sale");
      if (s.status === "void") throw bad("already_void", "This sale is already voided");
      await q.query("UPDATE sales SET status = 'void', voided_at = now(), void_reason = $2 WHERE id = $1", [s.id, b.reason]);
      await q.query("UPDATE payments SET voided_at = now(), void_reason = $2 WHERE sale_id = $1 AND voided_at IS NULL", [s.id, `Sale voided: ${b.reason}`]);
      if (b.restock) {
        // put back exactly what left the shelf, bundles included
        const items = await many(q, `SELECT product_id, -sum(qty)::int AS qty FROM stock_moves WHERE sale_id = $1 AND kind = 'sale' GROUP BY product_id HAVING sum(qty) < 0`, [s.id]);
        for (const it of items) {
          await q.query("UPDATE products SET stock = stock + $2 WHERE id = $1", [it.product_id, it.qty]);
          await q.query(`INSERT INTO stock_moves (gym_id, product_id, qty, kind, sale_id, note, by_user) VALUES ($1,$2,$3,'void',$4,$5,$6)`, [u.gymId, it.product_id, it.qty, s.id, b.reason, u.id]);
        }
      }
      await audit(q, u.gymId, u.id, "shop.sale.void", "sale", s.id, b);
      return { ok: true };
    });
  });

  r.get("/api/shop/summary", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const today = await gymToday(db, u.gymId);
    const from = zDate.parse(ctx.query.get("from") ?? today.slice(0, 8) + "01");
    const to = zDate.parse(ctx.query.get("to") ?? today);
    const range = "s.gym_id = $1 AND s.status <> 'void' AND (s.sold_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3";
    const [totals, top, byCategory, stock] = await Promise.all([
      one(db, `SELECT count(*)::int AS sales, coalesce(sum(total_usd),0) AS revenue, coalesce(sum(cost_usd),0) AS cost,
                      coalesce(sum(total_usd) FILTER (WHERE status = 'on_account'),0) AS on_account
                 FROM sales s JOIN gyms g ON g.id = s.gym_id WHERE ${range}`, [u.gymId, from, to]),
      many(db, `SELECT si.name, sum(si.qty)::int AS qty, round(sum(si.line_total_usd),2) AS revenue, round(sum(si.line_total_usd - si.unit_cost_usd * si.qty),2) AS margin
                  FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN gyms g ON g.id = s.gym_id WHERE ${range}
                 GROUP BY si.name ORDER BY revenue DESC LIMIT 10`, [u.gymId, from, to]),
      many(db, `SELECT coalesce(p.category,'other') AS category, round(sum(si.line_total_usd),2) AS revenue
                  FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN gyms g ON g.id = s.gym_id LEFT JOIN products p ON p.id = si.product_id
                 WHERE ${range} GROUP BY 1 ORDER BY revenue DESC`, [u.gymId, from, to]),
      one(db, `SELECT round(coalesce(sum(stock * cost_usd) FILTER (WHERE track_stock AND stock > 0),0),2) AS stock_value,
                      count(*) FILTER (WHERE active AND track_stock AND kind = 'item' AND stock <= low_stock_at)::int AS low_stock,
                      count(*) FILTER (WHERE active AND expires_on IS NOT NULL AND expires_on <= current_date + 30 AND stock > 0)::int AS expiring_soon
                 FROM products WHERE gym_id = $1`, [u.gymId]),
    ]);
    const revenue = Number(totals.revenue), cost = Number(totals.cost);
    return { from, to, ...totals, margin: round2(revenue - cost), margin_pct: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null, top, byCategory, ...stock, lowStock: await lowStock(db, u.gymId) };
  });
}
