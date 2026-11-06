-- 003: member engagement (offers, catalogue, badges, challenges, referrals),
-- PT self-booking (coach availability), bundles and product requests.

-- ---------- catalogue: product details, photos, bundles ----------
ALTER TABLE products ADD COLUMN description text;
ALTER TABLE products ADD COLUMN image bytea;
ALTER TABLE products ADD COLUMN image_mime text;
ALTER TABLE products ADD COLUMN in_app boolean NOT NULL DEFAULT true;  -- shown in the member app catalogue
ALTER TABLE products ADD COLUMN featured boolean NOT NULL DEFAULT false; -- shown on the member app home
-- a bundle is sold as one product; its stock is its components' stock
ALTER TABLE products ADD COLUMN kind text NOT NULL DEFAULT 'item' CHECK (kind IN ('item','bundle'));
ALTER TABLE products ADD COLUMN components jsonb NOT NULL DEFAULT '[]'; -- [{ "product_id": uuid, "qty": int }]

-- "I want it": a member asks for a product from the app; reception prepares it and sells it on pickup
CREATE TABLE product_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty         integer NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 20),
  note        text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','collected','cancelled')),
  sale_id     uuid REFERENCES sales(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_requests_gym_idx ON product_requests (gym_id, status, created_at DESC);
CREATE INDEX product_requests_member_idx ON product_requests (member_id, created_at DESC);

-- ---------- offers shown in the member app ----------
CREATE TABLE offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text,
  badge       text,          -- short label on the card: "-20%", "NEW", "2 for 1"
  kind        text NOT NULL DEFAULT 'offer' CHECK (kind IN ('offer','event','news')),
  product_id  uuid REFERENCES products(id) ON DELETE SET NULL,
  plan_id     uuid REFERENCES plans(id) ON DELETE SET NULL,
  image       bytea,
  image_mime  text,
  starts_on   date,
  ends_on     date,
  active      boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offers_gym_idx ON offers (gym_id, active);

-- ---------- PT self-booking ----------
ALTER TABLE pt_packages ADD COLUMN session_min integer NOT NULL DEFAULT 60 CHECK (session_min BETWEEN 15 AND 240);
ALTER TABLE pt_sessions ADD COLUMN duration_min integer NOT NULL DEFAULT 60;
ALTER TABLE pt_sessions ADD COLUMN booked_by text NOT NULL DEFAULT 'staff' CHECK (booked_by IN ('staff','member'));
CREATE INDEX pt_sessions_coach_time_idx ON pt_sessions (coach_id, starts_at) WHERE status = 'scheduled';

-- weekly windows when a coach takes PT sessions (local gym time)
CREATE TABLE coach_availability (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX coach_availability_coach_idx ON coach_availability (coach_id, weekday);

-- days off, holidays, a blocked afternoon
CREATE TABLE coach_time_off (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  note        text,
  CHECK (ends_at > starts_at)
);
CREATE INDEX coach_time_off_coach_idx ON coach_time_off (coach_id, ends_at);

-- ---------- engagement: badges, challenges, referrals ----------
ALTER TABLE members ADD COLUMN app_prefs jsonb NOT NULL DEFAULT '{}';  -- { weeklyGoal, hideOnLeaderboard }
ALTER TABLE members ADD COLUMN referral_code text;
ALTER TABLE members ADD COLUMN referred_by uuid REFERENCES members(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX members_referral_code_uq ON members (gym_id, referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE member_badges (
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  gym_id     uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  badge      text NOT NULL,
  earned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, badge)
);

CREATE TABLE challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  metric      text NOT NULL DEFAULT 'visits' CHECK (metric IN ('visits','classes')),
  target      integer NOT NULL CHECK (target BETWEEN 1 AND 1000),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  reward      text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX challenges_gym_idx ON challenges (gym_id, ends_on DESC);

ALTER TABLE leads ADD COLUMN referred_by uuid REFERENCES members(id) ON DELETE SET NULL;
CREATE INDEX leads_referred_by_idx ON leads (referred_by) WHERE referred_by IS NOT NULL;
