-- Each member's balance and last visit, kept up to date by the database itself.
--
-- Before this, member_overview recomputed both for every member on every read: four sums and a max over
-- payments, memberships, coaching packages, sales and check-ins. A list or the Today screen of a gym with
-- 2000 members did that 2000 times, and a load test of 60 gyms brought the server down at a quarter of a
-- normal evening's traffic. Now the numbers are written once when a payment, membership, sale, coaching
-- package or check-in changes, and member_overview only reads them from the member row.

-- They live on the member row itself, so reading them costs nothing more than reading the member.
ALTER TABLE members ADD COLUMN IF NOT EXISTS stat_balance_usd numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS stat_last_checkin timestamptz;

-- what a set of members owes: everything sold to them, minus everything they paid
CREATE OR REPLACE FUNCTION gms_refresh_balances(ids uuid[]) RETURNS void LANGUAGE sql AS $$
  UPDATE members m SET stat_balance_usd =
         coalesce((SELECT sum(price_usd) FROM memberships WHERE member_id = m.id AND status = 'active'), 0)
       + coalesce((SELECT sum(price_usd) FROM pt_packages WHERE member_id = m.id), 0)
       + coalesce((SELECT sum(total_usd) FROM sales WHERE member_id = m.id AND status <> 'void'), 0)
       - coalesce((SELECT sum(amount_usd) FROM payments WHERE member_id = m.id AND voided_at IS NULL), 0)
   WHERE m.id = ANY(ids);
$$;

CREATE OR REPLACE FUNCTION gms_refresh_last_checkin(ids uuid[]) RETURNS void LANGUAGE sql AS $$
  UPDATE members m SET stat_last_checkin = (SELECT max(c.at) FROM checkins c WHERE c.member_id = m.id AND c.result = 'ok')
   WHERE m.id = ANY(ids);
$$;

-- statement-level triggers: a bulk insert of 400 payments refreshes each member once, not 400 times
CREATE OR REPLACE FUNCTION gms_stats_balance_ins() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM gms_refresh_balances(ARRAY(SELECT DISTINCT member_id FROM new_rows WHERE member_id IS NOT NULL));
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION gms_stats_balance_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM gms_refresh_balances(ARRAY(
    SELECT member_id FROM new_rows WHERE member_id IS NOT NULL
    UNION SELECT member_id FROM old_rows WHERE member_id IS NOT NULL));
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION gms_stats_balance_del() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM gms_refresh_balances(ARRAY(SELECT DISTINCT member_id FROM old_rows WHERE member_id IS NOT NULL));
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships', 'pt_packages', 'sales', 'payments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %1$s_stats_ins ON %1$s', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %1$s_stats_upd ON %1$s', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %1$s_stats_del ON %1$s', t);
    EXECUTE format('CREATE TRIGGER %1$s_stats_ins AFTER INSERT ON %1$s REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION gms_stats_balance_ins()', t);
    EXECUTE format('CREATE TRIGGER %1$s_stats_upd AFTER UPDATE ON %1$s REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION gms_stats_balance_upd()', t);
    EXECUTE format('CREATE TRIGGER %1$s_stats_del AFTER DELETE ON %1$s REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION gms_stats_balance_del()', t);
  END LOOP;
END $$;

-- a new check-in only moves the last visit forward; an edited or removed one recomputes it
CREATE OR REPLACE FUNCTION gms_stats_checkin_ins() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE members m SET stat_last_checkin = greatest(m.stat_last_checkin, n.at)
    FROM (SELECT member_id, max(at) AS at FROM new_rows WHERE member_id IS NOT NULL AND result = 'ok' GROUP BY 1) n
   WHERE m.id = n.member_id AND (m.stat_last_checkin IS NULL OR m.stat_last_checkin < n.at);
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION gms_stats_checkin_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM gms_refresh_last_checkin(ARRAY(
    SELECT member_id FROM new_rows WHERE member_id IS NOT NULL
    UNION SELECT member_id FROM old_rows WHERE member_id IS NOT NULL));
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION gms_stats_checkin_del() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM gms_refresh_last_checkin(ARRAY(SELECT DISTINCT member_id FROM old_rows WHERE member_id IS NOT NULL));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS checkins_stats_ins ON checkins;
DROP TRIGGER IF EXISTS checkins_stats_upd ON checkins;
DROP TRIGGER IF EXISTS checkins_stats_del ON checkins;
CREATE TRIGGER checkins_stats_ins AFTER INSERT ON checkins REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION gms_stats_checkin_ins();
CREATE TRIGGER checkins_stats_upd AFTER UPDATE ON checkins REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION gms_stats_checkin_upd();
CREATE TRIGGER checkins_stats_del AFTER DELETE ON checkins REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION gms_stats_checkin_del();

-- fill it for the members that already exist, in one pass per table
UPDATE members m SET stat_balance_usd = x.balance, stat_last_checkin = x.last_checkin
  FROM (
    SELECT mm.id,
           coalesce(ms.s, 0) + coalesce(pt.s, 0) + coalesce(sa.s, 0) - coalesce(pa.s, 0) AS balance,
           lc.at AS last_checkin
      FROM members mm
      LEFT JOIN (SELECT member_id, sum(price_usd) AS s FROM memberships WHERE status = 'active' GROUP BY 1) ms ON ms.member_id = mm.id
      LEFT JOIN (SELECT member_id, sum(price_usd) AS s FROM pt_packages GROUP BY 1) pt ON pt.member_id = mm.id
      LEFT JOIN (SELECT member_id, sum(total_usd) AS s FROM sales WHERE status <> 'void' AND member_id IS NOT NULL GROUP BY 1) sa ON sa.member_id = mm.id
      LEFT JOIN (SELECT member_id, sum(amount_usd) AS s FROM payments WHERE voided_at IS NULL AND member_id IS NOT NULL GROUP BY 1) pa ON pa.member_id = mm.id
      LEFT JOIN (SELECT member_id, max(at) AS at FROM checkins WHERE result = 'ok' AND member_id IS NOT NULL GROUP BY 1) lc ON lc.member_id = mm.id
  ) x
 WHERE x.id = m.id;

-- member_overview: same columns as before; the balance and the last visit are now read from the member row
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
       m.stat_balance_usd::numeric AS balance_usd,
       m.stat_last_checkin AS last_checkin,
       cs.score AS churn_score
  FROM members m
  JOIN gyms g ON g.id = m.gym_id
  CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE g.timezone)::date AS today) t
  LEFT JOIN LATERAL (
    SELECT ms.* FROM memberships ms
     WHERE ms.member_id = m.id AND ms.status = 'active'
     ORDER BY (ms.start_date <= t.today AND ms.end_date >= t.today) DESC, ms.end_date DESC
     LIMIT 1) cur ON true
  LEFT JOIN churn_scores cs ON cs.member_id = m.id;
