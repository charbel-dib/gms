/**
 * Where a gym stands in getting started. Five things, each one observable in the data,
 * so the owner sees what is left and the platform sees which gyms are stuck.
 */
export const SETUP_STEPS = ["logo", "prices", "members", "payment", "checkin"] as const;

/** SQL expression (for a row of `gyms` aliased as `alias`) that yields { logo, prices, members, payment, checkin }. */
export const setupSql = (alias: string) => `jsonb_build_object(
  'logo', ${alias}.logo IS NOT NULL OR COALESCE((${alias}.settings->'setup'->>'logoSkipped')::boolean, false),
  'prices', COALESCE((${alias}.settings->'setup'->>'prices')::boolean, false),
  'members', EXISTS (SELECT 1 FROM members sm WHERE sm.gym_id = ${alias}.id),
  'payment', EXISTS (SELECT 1 FROM payments sp WHERE sp.gym_id = ${alias}.id),
  'checkin', EXISTS (SELECT 1 FROM checkins sc WHERE sc.gym_id = ${alias}.id))`;

export const markPricesChecked = `UPDATE gyms SET settings = jsonb_set(settings, '{setup}', COALESCE(settings->'setup', '{}'::jsonb) || '{"prices": true}'::jsonb) WHERE id = $1`;
