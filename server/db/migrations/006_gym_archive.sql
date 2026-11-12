-- 006: a gym that leaves GMS is archived, not deleted: its data stays, its team and members can no longer sign in,
-- and it can be brought back as it was. Deleting for good is a separate, explicit action.
ALTER TABLE gyms ADD COLUMN archived_at timestamptz;
ALTER TABLE gyms ADD COLUMN archived_reason text;
