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

export const PRODUCT_CATEGORIES = ["supplements", "drinks", "snacks", "accessories", "apparel", "other"] as const;

const productSchema = z.object({
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
});

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function lowStock(q: Queryable, gymId: string) {
  return many(q, `SELECT id, name, stock, low_stock_at FROM products WHERE gym_id = $1 AND active AND track_stock AND stock <= low_stock_at ORDER BY stock, name LIMIT 30`, [gymId]);
}

interface SaleInput {
  member_id?: string | null;
  customer_name?: string | null;
  items: { product_id: string; qty: number }[];
  discount_usd?: number;
  on_account?: boolean;
  note?: string | null;
  payment?: { currency: "USD" | "LBP"; method: string; reference?: string | null } | null;
}

/** Creates a sale atomically: locks products, checks stock, decrements it, records the payment. */
export async function createSale(q: Queryable, gymId: string, userId: string | null, input: SaleInput) {
  if (!input.items.length) throw bad("empty_cart", "Add at least one product");
  if (input.on_account && !input.member_id) throw bad("member_required", "Choose a member to put the sale on their account");
  if (!input.on_account && !input.payment) throw bad("payment_required", "Choose how the customer pays");
  if (input.member_id) await getOverview(q, gymId, input.member_id);

  // merge duplicate lines, lock products in a stable order (avoids deadlocks between two tills)
  const qty = new Map<string, number>();
  for (const it of input.items) qty.set(it.product_id, (qty.get(it.product_id) ?? 0) + it.qty);
  const ids = [...qty.keys()].sort();
  const products = await many(q, `SELECT * FROM products WHERE gym_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [gymId, ids]);
  if (products.length !== ids.length) throw notFound("product");

  const rate = await gymRate(q, gymId);
  const lines = products.map((p) => {
    const n = qty.get(p.id)!;
    if (!p.active) throw bad("product_inactive", `${p.name} is no longer on sale`);
    if (p.track_stock && p.stock < n) throw bad("out_of_stock", `Only ${p.stock} × ${p.name} left in stock`);
    return { p, n, lineUsd: round2(toUsd(Number(p.price), p.currency, rate) * n), costUsd: round2(Number(p.cost_usd) * n) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineUsd, 0));
  const discount = Math.min(round2(input.discount_usd ?? 0), subtotal);
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
      [sale!.id, l.p.id, l.p.name, l.n, l.p.price, l.p.currency, l.lineUsd, l.p.cost_usd],
    );
    if (l.p.track_stock) {
      await q.query("UPDATE products SET stock = stock - $2 WHERE id = $1", [l.p.id, l.n]);
      await q.query(`INSERT INTO stock_moves (gym_id, product_id, qty, kind, sale_id, by_user) VALUES ($1,$2,$3,'sale',$4,$5)`, [gymId, l.p.id, -l.n, sale!.id, userId]);
    }
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
      SELECT p.*,
             (SELECT coalesce(sum(si.qty), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
               WHERE si.product_id = p.id AND s.status <> 'void' AND s.sold_at > now() - interval '30 days')::int AS sold_30d
        FROM products p WHERE ${where.join(" AND ")}
       ORDER BY p.active DESC, p.category, p.name`, vals);
  });

  r.get("/api/shop/barcode/:code", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const p = await one(db, "SELECT * FROM products WHERE gym_id = $1 AND barcode = $2 AND active", [u.gymId, ctx.params.code.trim()]);
    if (!p) throw notFound("product with this barcode");
    return p;
  });

  r.post("/api/shop/products", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(productSchema.extend({ stock: z.coerce.number().int().min(0).max(1000000).default(0) }));
    return db.tx(async (q) => {
      const p = await one(q, `INSERT INTO products (gym_id, name, name_ar, category, brand, barcode, price, currency, cost_usd, stock, low_stock_at, track_stock, expires_on, active)
                              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [u.gymId, b.name, b.name_ar ?? null, b.category, b.brand ?? null, b.barcode, b.price, b.currency, b.cost_usd, b.stock, b.low_stock_at, b.track_stock, b.expires_on ?? null, b.active]);
      if (b.stock > 0) await q.query(`INSERT INTO stock_moves (gym_id, product_id, qty, kind, unit_cost_usd, by_user) VALUES ($1,$2,$3,'initial',$4,$5)`, [u.gymId, p!.id, b.stock, b.cost_usd, u.id]);
      await audit(q, u.gymId, u.id, "shop.product.create", "product", p!.id);
      return p;
    });
  });

  r.put("/api/shop/products/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(productSchema);
    const p = await one(db, `UPDATE products SET name=$3, name_ar=$4, category=$5, brand=$6, barcode=$7, price=$8, currency=$9, cost_usd=$10, low_stock_at=$11, track_stock=$12, expires_on=$13, active=$14
                              WHERE id = $1 AND gym_id = $2 RETURNING *`,
      [zId.parse(ctx.params.id), u.gymId, b.name, b.name_ar ?? null, b.category, b.brand ?? null, b.barcode, b.price, b.currency, b.cost_usd, b.low_stock_at, b.track_stock, b.expires_on ?? null, b.active]);
    if (!p) throw notFound("product");
    await audit(db, u.gymId, u.id, "shop.product.update", "product", p.id);
    return p;
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
      const p = await one(q, "SELECT * FROM products WHERE id = $1 AND gym_id = $2 FOR UPDATE", [zId.parse(ctx.params.id), u.gymId]);
      if (!p) throw notFound("product");
      if (p.stock + b.qty < 0) throw bad("negative_stock", `Stock cannot go below 0 (now ${p.stock})`);
      // weighted average purchase cost, so margins stay right when supplier prices change
      let cost = Number(p.cost_usd);
      if (b.kind === "restock" && b.unit_cost_usd != null) {
        const before = Math.max(p.stock, 0);
        cost = before + b.qty > 0 ? round2((before * cost + b.qty * b.unit_cost_usd) / (before + b.qty)) : b.unit_cost_usd;
      }
      const row = await one(q, `UPDATE products SET stock = stock + $2, cost_usd = $3, expires_on = coalesce($4, expires_on) WHERE id = $1 RETURNING *`, [p.id, b.qty, cost, b.expires_on ?? null]);
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
    }));
    return db.tx((q) => createSale(q, u.gymId, u.id, b));
  });

  r.get("/api/shop/sales", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const today = await gymToday(db, u.gymId);
    const from = zDate.parse(ctx.query.get("from") ?? today);
    const to = zDate.parse(ctx.query.get("to") ?? today);
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
        const items = await many(q, `SELECT si.product_id, si.qty FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1 AND p.track_stock`, [s.id]);
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
                      count(*) FILTER (WHERE active AND track_stock AND stock <= low_stock_at)::int AS low_stock,
                      count(*) FILTER (WHERE active AND expires_on IS NOT NULL AND expires_on <= current_date + 30 AND stock > 0)::int AS expiring_soon
                 FROM products WHERE gym_id = $1`, [u.gymId]),
    ]);
    const revenue = Number(totals.revenue), cost = Number(totals.cost);
    return { from, to, ...totals, margin: round2(revenue - cost), margin_pct: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null, top, byCategory, ...stock, lowStock: await lowStock(db, u.gymId) };
  });
}
