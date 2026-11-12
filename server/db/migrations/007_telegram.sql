-- 007: Telegram. One GMS bot for every gym (its token lives here, encrypted, set from the platform page).
-- A member, a staff member or the operator connects their Telegram by opening a one-time link (t.me/<bot>?start=<code>).
-- Once a member is connected and the gym has Telegram on, their reminders and messages go there instead of WhatsApp.
CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telegram_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id          bigint NOT NULL,
  username         text,
  gym_id           uuid REFERENCES gyms(id) ON DELETE CASCADE,
  member_id        uuid REFERENCES members(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  last_summary_on  date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((member_id IS NULL) <> (user_id IS NULL))
);
CREATE UNIQUE INDEX telegram_links_member_uq ON telegram_links (member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX telegram_links_user_uq ON telegram_links (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX telegram_links_chat_idx ON telegram_links (chat_id);

CREATE TABLE telegram_codes (
  code        text PRIMARY KEY,
  gym_id      uuid REFERENCES gyms(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES members(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);

-- which channel a message went out on
ALTER TABLE messages ADD COLUMN channel text NOT NULL DEFAULT 'whatsapp';
