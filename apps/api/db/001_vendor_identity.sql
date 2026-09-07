-- The marketplace and the money layer disagree about what a vendor IS, and until
-- now nothing reconciled them.
--
--   marketplace:  seller.id       is TEXT   — 'sel_01M1Y8JJNR8VZT9QN8X9HNQK79'
--   money layer:  payees.party_id is BIGINT — a number, and ledger_accounts.owner_id
--                                             is BIGINT too
--
-- So a per-vendor ledger account could not even be addressed, and a payout could
-- never have been aimed at anyone. The aggregate ledger entry hid this: with
-- owner_id NULL there was nothing to reconcile.
--
-- This table is the seam, made explicit and given a name. One stable number per
-- seller, allocated once, never reused. It is deliberately dumb: no status, no
-- money, no lifecycle — those belong to the money layer's own vendor tables. This
-- says only "this string and this number are the same vendor".
CREATE TABLE IF NOT EXISTS vendor_identity (
  vendor_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id  TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vendor_identity IS
  'Maps a marketplace seller id (TEXT) to the numeric vendor id the money layer uses. One row per seller, allocated on first capture, never reused.';
