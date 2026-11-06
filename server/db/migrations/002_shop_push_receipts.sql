-- 002: shareable receipts, shop (supplements & products), push notifications.

-- ---------- receipts ----------
-- Unguessable token for the public receipt link sent to members (/r/<token>)
ALTER TABLE payments ADD COLUMN public_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');
CREATE UNIQUE INDEX payments_public_token_uq ON payments (public_token);

-- ---------- shop ----------
CREATE TABLE products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id         uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name           text NOT NULL,
  name_ar        text,
  category       text NOT NULL DEFAULT 'supplements',
  brand          text,
  barcode        text,
  price          numeric(14,2) NOT NULL CHECK (price >= 0),
  currency       text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','LBP')),
  cost_usd       numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0), -- purchase cost per unit, for margins
  stock          integer NOT NULL DEFAULT 0,
  low_stock_at   integer NOT NULL DEFAULT 5,
  track_stock    boolean NOT NULL DEFAULT true,
  expires_on     date,  -- nearest expiry date of the batch on the shelf (supplements expire)
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_gym_idx ON products (gym_id, active);
CREATE UNIQUE INDEX products_barcode_uq ON products (gym_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';

CREATE TABLE sales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  sale_no       integer NOT NULL,
  member_id     uuid REFERENCES members(id) ON DELETE SET NULL,
  customer_name text,
  subtotal_usd  numeric(14,2) NOT NULL,
  discount_usd  numeric(14,2) NOT NULL DEFAULT 0,
  total_usd     numeric(14,2) NOT NULL CHECK (total_usd >= 0),
  cost_usd      numeric(14,2) NOT NULL DEFAULT 0,
  lbp_rate      numeric(12,2) NOT NULL,
  status        text NOT NULL CHECK (status IN ('paid','on_account','void')),
  note          text,
  sold_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  sold_at       timestamptz NOT NULL DEFAULT now(),
  voided_at     timestamptz,
  void_reason   text,
  UNIQUE (gym_id, sale_no)
);
CREATE INDEX sales_gym_time_idx ON sales (gym_id, sold_at DESC);
CREATE INDEX sales_member_idx ON sales (member_id);

CREATE TABLE sale_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id        uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  name           text NOT NULL,
  qty            integer NOT NULL CHECK (qty > 0),
  unit_price     numeric(14,2) NOT NULL,
  currency       text NOT NULL CHECK (currency IN ('USD','LBP')),
  line_total_usd numeric(14,2) NOT NULL,
  unit_cost_usd  numeric(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);

CREATE TABLE stock_moves (
  id            bigserial PRIMARY KEY,
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty           integer NOT NULL,                -- + in, - out
  kind          text NOT NULL CHECK (kind IN ('restock','sale','void','adjust','initial')),
  unit_cost_usd numeric(14,2),
  sale_id       uuid REFERENCES sales(id) ON DELETE SET NULL,
  note          text,
  by_user       uuid REFERENCES users(id) ON DELETE SET NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_moves_product_idx ON stock_moves (product_id, at DESC);

ALTER TABLE payments ADD COLUMN sale_id uuid REFERENCES sales(id) ON DELETE SET NULL;
CREATE INDEX payments_sale_idx ON payments (sale_id);

-- Balances now include shop purchases put on the member's account.
CREATE OR REPLACE VIEW member_overview AS
SELECT m.id, m.gym_id, m.code, m.qr_token, m.first_name, m.last_name, m.phone, m.email, m.gender,
       m.birth_date, m.source, m.tags, m.notes, m.whatsapp_opt_in, m.archived_at, m.created_at,
       (m.pin_hash IS NOT NULL) AS has_app_access,
       cur.id AS membership_id, cur.plan_id, cur.plan_name, cur.start_date, cur.end_date,
       cur.visits_total, cur.visits_used, cur.frozen_from, cur.frozen_until, cur.includes_classes,
       CASE
         WHEN cur.id IS NULL THEN 'none'
         WHEN cur.frozen_from IS NOT NULL AND t.today BETWEEN cur.frozen_from AND cur.frozen_until THEN 'frozen'
         WHEN cur.end_date < t.today OR (cur.visits_total IS NOT NULL AND cur.visits_used >= cur.visits_total) THEN 'expired'
         WHEN cur.start_date > t.today THEN 'upcoming'
         WHEN cur.end_date - t.today <= 7 THEN 'expiring'
         ELSE 'active'
       END AS status,
       (cur.end_date - t.today) AS days_left,
       round(bal.balance_usd, 2) AS balance_usd,
       lc.last_checkin,
       cs.score AS churn_score
  FROM members m
  JOIN gyms g ON g.id = m.gym_id
  CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE g.timezone)::date AS today) t
  LEFT JOIN LATERAL (
    SELECT ms.* FROM memberships ms
     WHERE ms.member_id = m.id AND ms.status = 'active'
     ORDER BY (ms.start_date <= t.today AND ms.end_date >= t.today) DESC, ms.end_date DESC
     LIMIT 1) cur ON true
  LEFT JOIN LATERAL (
    SELECT max(c.at) AS last_checkin FROM checkins c WHERE c.member_id = m.id AND c.result = 'ok') lc ON true
  LEFT JOIN LATERAL (
    SELECT coalesce((SELECT sum(price_usd) FROM memberships WHERE member_id = m.id AND status = 'active'), 0)
         + coalesce((SELECT sum(price_usd) FROM pt_packages WHERE member_id = m.id), 0)
         + coalesce((SELECT sum(total_usd) FROM sales WHERE member_id = m.id AND status <> 'void'), 0)
         - coalesce((SELECT sum(amount_usd) FROM payments WHERE member_id = m.id AND voided_at IS NULL), 0) AS balance_usd) bal ON true
  LEFT JOIN churn_scores cs ON cs.member_id = m.id;

-- shop is available on every plan; existing gyms get it switched on
UPDATE gyms SET modules = modules || '{"shop": true}'::jsonb WHERE NOT (modules ? 'shop');

-- ---------- push notifications ----------
CREATE TABLE app_config (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES members(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  failures    integer NOT NULL DEFAULT 0,
  last_ok_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_member_idx ON push_subscriptions (member_id);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  url         text,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','no_device','failed')),
  devices     integer NOT NULL DEFAULT 0,
  dedupe_key  text,
  send_after  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  read_at     timestamptz,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX notifications_member_idx ON notifications (member_id, created_at DESC);
CREATE INDEX notifications_queue_idx ON notifications (send_after) WHERE status = 'queued';
CREATE INDEX notifications_gym_idx ON notifications (gym_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (gym_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- what each member wants to receive (missing key = yes)
ALTER TABLE members ADD COLUMN notify_prefs jsonb NOT NULL DEFAULT '{}';
