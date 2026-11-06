-- 004: per-gym installable app icon, demo requests from the GMS website.

-- square PNG icons generated in the browser from the gym's logo (or initial) for the installed app
ALTER TABLE gyms ADD COLUMN app_icon_512 bytea;
ALTER TABLE gyms ADD COLUMN app_icon_192 bytea;
ALTER TABLE gyms ADD COLUMN app_icon_updated_at timestamptz;

CREATE TABLE demo_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  gym_name    text NOT NULL,
  city        text,
  phone       text NOT NULL,
  email       text,
  members     text,          -- rough size: "<100", "100-300", "300+"
  message     text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','demo_booked','won','lost')),
  notes       text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_requests_created_idx ON demo_requests (created_at DESC);
