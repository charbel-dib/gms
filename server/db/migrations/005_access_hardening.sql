-- 005: access review fixes.

-- a password chosen by someone else (new staff account, reset) must be replaced at first sign-in
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- two-step sign-in (authenticator app codes) for platform admins
ALTER TABLE users ADD COLUMN totp_secret_enc text;
ALTER TABLE users ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN totp_last_step bigint; -- a code is accepted once

-- demo data can only be generated in gyms created for demos
ALTER TABLE gyms ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
UPDATE gyms SET is_demo = true WHERE slug IN ('demo', 'demo-box');

-- a WhatsApp Business number belongs to one gym only: keep it on the oldest gym if two share one
UPDATE gyms g SET settings = jsonb_set(g.settings, '{whatsapp,phoneNumberId}', 'null'::jsonb)
 WHERE g.settings->'whatsapp'->>'phoneNumberId' IS NOT NULL
   AND EXISTS (SELECT 1 FROM gyms o WHERE o.settings->'whatsapp'->>'phoneNumberId' = g.settings->'whatsapp'->>'phoneNumberId'
                                      AND (o.created_at, o.id) < (g.created_at, g.id));
CREATE UNIQUE INDEX gyms_whatsapp_number_uniq ON gyms ((settings->'whatsapp'->>'phoneNumberId'))
  WHERE settings->'whatsapp'->>'phoneNumberId' IS NOT NULL;
