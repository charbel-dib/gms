-- GMS initial schema. Multi-tenant: every business table carries gym_id.
-- Money: numeric(14,2) in the original currency + amount_usd normalized at the
-- LBP rate of the day, so reports stay correct when the exchange rate moves.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE gyms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name            text NOT NULL,
  name_ar         text,
  tagline         text,
  logo            bytea,
  logo_mime       text,
  brand_color     text NOT NULL DEFAULT '#E4572E',
  phone           text,
  whatsapp        text,
  email           text,
  instagram       text,
  address         text,
  city            text,
  timezone        text NOT NULL DEFAULT 'Asia/Beirut',
  default_currency text NOT NULL DEFAULT 'USD' CHECK (default_currency IN ('USD','LBP')),
  lbp_rate        numeric(12,2) NOT NULL DEFAULT 89500,
  locale          text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar')),
  modules         jsonb NOT NULL DEFAULT '{"classes":true,"pt":true,"whatsapp":true,"ai":true,"memberApp":true,"expenses":true,"leads":true}',
  settings        jsonb NOT NULL DEFAULT '{}',
  saas_plan       text NOT NULL DEFAULT 'pro' CHECK (saas_plan IN ('starter','pro','elite')),
  saas_status     text NOT NULL DEFAULT 'trial' CHECK (saas_status IN ('trial','active','past_due','suspended')),
  saas_price_usd  numeric(10,2) NOT NULL DEFAULT 59,
  saas_paid_until date,
  trial_ends_at   date DEFAULT (current_date + 30),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id         uuid REFERENCES gyms(id) ON DELETE CASCADE,
  email          text NOT NULL,
  name           text NOT NULL,
  phone          text,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('superadmin','owner','manager','reception','coach')),
  active         boolean NOT NULL DEFAULT true,
  bio            text,
  color          text,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'superadmin') = (gym_id IS NULL))
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_gym_idx ON users (gym_id);

CREATE TABLE members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id           uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  code             integer NOT NULL,
  qr_token         text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  first_name       text NOT NULL,
  last_name        text NOT NULL DEFAULT '',
  phone            text,
  email            text,
  gender           text CHECK (gender IN ('male','female')),
  birth_date       date,
  emergency_contact text,
  notes            text,
  source           text,
  tags             text[] NOT NULL DEFAULT '{}',
  pin_hash         text,
  whatsapp_opt_in  boolean NOT NULL DEFAULT true,
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gym_id, code)
);
CREATE INDEX members_gym_idx ON members (gym_id) WHERE archived_at IS NULL;
CREATE INDEX members_phone_idx ON members (gym_id, phone);
CREATE INDEX members_search_idx ON members USING gin (to_tsvector('simple', first_name || ' ' || last_name || ' ' || coalesce(phone,'')));

CREATE TABLE plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id             uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name               text NOT NULL,
  name_ar            text,
  kind               text NOT NULL DEFAULT 'time' CHECK (kind IN ('time','visits')),
  duration_days      integer NOT NULL CHECK (duration_days > 0),
  visits             integer CHECK (visits IS NULL OR visits > 0),
  price              numeric(14,2) NOT NULL CHECK (price >= 0),
  currency           text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','LBP')),
  includes_classes   boolean NOT NULL DEFAULT true,
  gender_restriction text CHECK (gender_restriction IN ('male','female')),
  freeze_days_allowed integer NOT NULL DEFAULT 0,
  description        text,
  active             boolean NOT NULL DEFAULT true,
  sort               integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'time' OR visits IS NOT NULL)
);
CREATE INDEX plans_gym_idx ON plans (gym_id);

CREATE TABLE memberships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id         uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id           uuid REFERENCES plans(id) ON DELETE SET NULL,
  plan_name         text NOT NULL,
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  visits_total      integer,
  visits_used       integer NOT NULL DEFAULT 0,
  price             numeric(14,2) NOT NULL,
  discount          numeric(14,2) NOT NULL DEFAULT 0,
  price_usd         numeric(14,2) NOT NULL, -- (price - discount) in USD at the rate of the sale
  currency          text NOT NULL CHECK (currency IN ('USD','LBP')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  frozen_from       date,
  frozen_until      date,
  freeze_days_used  integer NOT NULL DEFAULT 0,
  freeze_days_allowed integer NOT NULL DEFAULT 0,
  includes_classes  boolean NOT NULL DEFAULT true,
  notes             text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX memberships_member_idx ON memberships (member_id, end_date DESC);
CREATE INDEX memberships_gym_end_idx ON memberships (gym_id, end_date) WHERE status = 'active';

CREATE TABLE pt_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  coach_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  title           text NOT NULL DEFAULT 'Personal training',
  sessions_total  integer NOT NULL CHECK (sessions_total > 0),
  sessions_used   integer NOT NULL DEFAULT 0,
  price           numeric(14,2) NOT NULL,
  currency        text NOT NULL CHECK (currency IN ('USD','LBP')),
  price_usd       numeric(14,2) NOT NULL,
  expires_on      date,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pt_packages_member_idx ON pt_packages (member_id);
CREATE INDEX pt_packages_coach_idx ON pt_packages (gym_id, coach_id);

CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id     uuid REFERENCES members(id) ON DELETE SET NULL,
  membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  pt_package_id uuid REFERENCES pt_packages(id) ON DELETE SET NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  currency      text NOT NULL CHECK (currency IN ('USD','LBP')),
  lbp_rate      numeric(12,2) NOT NULL,
  amount_usd    numeric(14,2) NOT NULL,
  method        text NOT NULL CHECK (method IN ('cash','whish','omt','card','bank','other')),
  reference     text,
  note          text,
  receipt_no    integer NOT NULL,
  received_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at       timestamptz NOT NULL DEFAULT now(),
  voided_at     timestamptz,
  void_reason   text,
  UNIQUE (gym_id, receipt_no)
);
CREATE INDEX payments_gym_time_idx ON payments (gym_id, paid_at DESC);
CREATE INDEX payments_member_idx ON payments (member_id);
CREATE INDEX payments_membership_idx ON payments (membership_id);

CREATE TABLE checkins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  method        text NOT NULL CHECK (method IN ('qr','manual','app')),
  result        text NOT NULL CHECK (result IN ('ok','denied')),
  reason        text,
  by_user       uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX checkins_gym_time_idx ON checkins (gym_id, at DESC);
CREATE INDEX checkins_member_idx ON checkins (member_id, at DESC);

CREATE TABLE class_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id           uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name             text NOT NULL,
  name_ar          text,
  color            text NOT NULL DEFAULT '#3D5A80',
  description      text,
  default_capacity integer NOT NULL DEFAULT 15,
  duration_min     integer NOT NULL DEFAULT 60,
  women_only       boolean NOT NULL DEFAULT false,
  active           boolean NOT NULL DEFAULT true
);
CREATE INDEX class_types_gym_idx ON class_types (gym_id);

CREATE TABLE class_schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  class_type_id uuid NOT NULL REFERENCES class_types(id) ON DELETE CASCADE,
  coach_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  start_time    time NOT NULL,
  duration_min  integer NOT NULL,
  capacity      integer NOT NULL,
  room          text,
  active        boolean NOT NULL DEFAULT true
);
CREATE INDEX class_schedules_gym_idx ON class_schedules (gym_id);

CREATE TABLE class_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  schedule_id   uuid REFERENCES class_schedules(id) ON DELETE SET NULL,
  class_type_id uuid NOT NULL REFERENCES class_types(id) ON DELETE CASCADE,
  coach_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  capacity      integer NOT NULL,
  room          text,
  cancelled     boolean NOT NULL DEFAULT false,
  UNIQUE (schedule_id, starts_at)
);
CREATE INDEX class_sessions_gym_time_idx ON class_sessions (gym_id, starts_at);

CREATE TABLE bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','waitlist','cancelled','attended','no_show')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, member_id)
);
CREATE INDEX bookings_member_idx ON bookings (member_id);

CREATE TABLE pt_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  package_id  uuid NOT NULL REFERENCES pt_packages(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  coach_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  starts_at   timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled','no_show')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pt_sessions_gym_time_idx ON pt_sessions (gym_id, starts_at);

CREATE TABLE programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  coach_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX programs_member_idx ON programs (member_id);

CREATE TABLE expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('rent','salaries','generator','electricity','equipment','maintenance','marketing','supplies','other')),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  currency    text NOT NULL CHECK (currency IN ('USD','LBP')),
  lbp_rate    numeric(12,2) NOT NULL,
  amount_usd  numeric(14,2) NOT NULL,
  spent_on    date NOT NULL DEFAULT current_date,
  note        text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_gym_idx ON expenses (gym_id, spent_on DESC);

CREATE TABLE leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name         text NOT NULL,
  phone        text,
  source       text,
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','trial','converted','lost')),
  interest     text,
  notes        text,
  follow_up_on date,
  member_id    uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_gym_idx ON leads (gym_id, status);

CREATE TABLE knowledge_docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_docs_gym_idx ON knowledge_docs (gym_id);

CREATE TABLE messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id    uuid REFERENCES members(id) ON DELETE SET NULL,
  phone        text,
  direction    text NOT NULL CHECK (direction IN ('out','in')),
  kind         text NOT NULL,
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','read','failed','received','manual')),
  provider_id  text,
  error        text,
  dedupe_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX messages_gym_idx ON messages (gym_id, created_at DESC);
CREATE UNIQUE INDEX messages_dedupe_uq ON messages (gym_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE churn_scores (
  member_id    uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  gym_id       uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  score        numeric(5,4) NOT NULL,
  factors      jsonb NOT NULL,
  model        text NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX churn_scores_gym_idx ON churn_scores (gym_id, score DESC);

CREATE TABLE ai_models (
  gym_id      uuid PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  params      jsonb NOT NULL,
  metrics     jsonb NOT NULL,
  trained_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('staff','member')),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES members(id) ON DELETE CASCADE,
  gym_id      uuid REFERENCES gyms(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ip          text,
  user_agent  text
);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  gym_id     uuid REFERENCES gyms(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  data       jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_gym_idx ON audit_log (gym_id, at DESC);

CREATE TABLE login_attempts (
  key        text PRIMARY KEY,
  count      integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

-- Per-gym sequences for member codes and receipt numbers
CREATE TABLE counters (
  gym_id  uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name    text NOT NULL,
  value   integer NOT NULL,
  PRIMARY KEY (gym_id, name)
);

-- One row per member with the membership that matters today, its status,
-- days left, outstanding balance (USD) and last visit. Used by lists, check-in and AI.
CREATE VIEW member_overview AS
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
         - coalesce((SELECT sum(amount_usd) FROM payments WHERE member_id = m.id AND voided_at IS NULL), 0) AS balance_usd) bal ON true
  LEFT JOIN churn_scores cs ON cs.member_id = m.id;
