-- An index on every foreign key column.
--
-- When a row is deleted, Postgres looks for the rows that point to it in every table that references it
-- (to delete them, or to clear the link). Without an index on the pointing column, that look is a full
-- read of the table, once per deleted row. Deleting one gym of 2000 members meant reading every check-in
-- of every gym once per membership: thousands of full reads of millions of rows, which on the production
-- database would have taken days. With these indexes it takes seconds.
--
-- Deleting a member, a membership, a coach or a sale gets the same benefit.
CREATE INDEX IF NOT EXISTS audit_log_user_id_fk_idx ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS bookings_gym_id_fk_idx ON bookings (gym_id);
CREATE INDEX IF NOT EXISTS checkins_by_user_fk_idx ON checkins (by_user);
CREATE INDEX IF NOT EXISTS checkins_membership_id_fk_idx ON checkins (membership_id);
CREATE INDEX IF NOT EXISTS class_schedules_class_type_id_fk_idx ON class_schedules (class_type_id);
CREATE INDEX IF NOT EXISTS class_schedules_coach_id_fk_idx ON class_schedules (coach_id);
CREATE INDEX IF NOT EXISTS class_sessions_class_type_id_fk_idx ON class_sessions (class_type_id);
CREATE INDEX IF NOT EXISTS class_sessions_coach_id_fk_idx ON class_sessions (coach_id);
CREATE INDEX IF NOT EXISTS coach_availability_gym_id_fk_idx ON coach_availability (gym_id);
CREATE INDEX IF NOT EXISTS coach_time_off_gym_id_fk_idx ON coach_time_off (gym_id);
CREATE INDEX IF NOT EXISTS expenses_created_by_fk_idx ON expenses (created_by);
CREATE INDEX IF NOT EXISTS leads_member_id_fk_idx ON leads (member_id);
CREATE INDEX IF NOT EXISTS member_badges_gym_id_fk_idx ON member_badges (gym_id);
CREATE INDEX IF NOT EXISTS members_referred_by_fk_idx ON members (referred_by);
CREATE INDEX IF NOT EXISTS memberships_created_by_fk_idx ON memberships (created_by);
CREATE INDEX IF NOT EXISTS memberships_plan_id_fk_idx ON memberships (plan_id);
CREATE INDEX IF NOT EXISTS messages_member_id_fk_idx ON messages (member_id);
CREATE INDEX IF NOT EXISTS notifications_created_by_fk_idx ON notifications (created_by);
CREATE INDEX IF NOT EXISTS offers_plan_id_fk_idx ON offers (plan_id);
CREATE INDEX IF NOT EXISTS offers_product_id_fk_idx ON offers (product_id);
CREATE INDEX IF NOT EXISTS payments_pt_package_id_fk_idx ON payments (pt_package_id);
CREATE INDEX IF NOT EXISTS payments_received_by_fk_idx ON payments (received_by);
CREATE INDEX IF NOT EXISTS product_requests_product_id_fk_idx ON product_requests (product_id);
CREATE INDEX IF NOT EXISTS product_requests_sale_id_fk_idx ON product_requests (sale_id);
CREATE INDEX IF NOT EXISTS programs_coach_id_fk_idx ON programs (coach_id);
CREATE INDEX IF NOT EXISTS programs_gym_id_fk_idx ON programs (gym_id);
CREATE INDEX IF NOT EXISTS pt_packages_coach_id_fk_idx ON pt_packages (coach_id);
CREATE INDEX IF NOT EXISTS pt_sessions_member_id_fk_idx ON pt_sessions (member_id);
CREATE INDEX IF NOT EXISTS pt_sessions_package_id_fk_idx ON pt_sessions (package_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_gym_id_fk_idx ON push_subscriptions (gym_id);
CREATE INDEX IF NOT EXISTS sales_sold_by_fk_idx ON sales (sold_by);
CREATE INDEX IF NOT EXISTS sessions_gym_id_fk_idx ON sessions (gym_id);
CREATE INDEX IF NOT EXISTS sessions_member_id_fk_idx ON sessions (member_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_fk_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS stock_moves_by_user_fk_idx ON stock_moves (by_user);
CREATE INDEX IF NOT EXISTS stock_moves_gym_id_fk_idx ON stock_moves (gym_id);
CREATE INDEX IF NOT EXISTS stock_moves_sale_id_fk_idx ON stock_moves (sale_id);
CREATE INDEX IF NOT EXISTS telegram_codes_gym_id_fk_idx ON telegram_codes (gym_id);
CREATE INDEX IF NOT EXISTS telegram_codes_member_id_fk_idx ON telegram_codes (member_id);
CREATE INDEX IF NOT EXISTS telegram_codes_user_id_fk_idx ON telegram_codes (user_id);
CREATE INDEX IF NOT EXISTS telegram_links_gym_id_fk_idx ON telegram_links (gym_id);
