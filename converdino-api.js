-- ════════════════════════════════════════════════════════════════
-- CONVERDINO · SCHRITT B · Verhandlungs-Engine Migration
-- ════════════════════════════════════════════════════════════════
-- Erweitert cv_bot_sessions um Verhandlungs-State + Käufer-Kontakt,
-- legt cv_events an (Lead-/Deal-/Eskalations-Protokoll für Verkäufer)
-- ════════════════════════════════════════════════════════════════

-- ── Bot-Session: Phase, Preis, Käuferkontakt ────────────────────
ALTER TABLE cv_bot_sessions
  ADD COLUMN IF NOT EXISTS phase          TEXT DEFAULT 'interest',  -- interest/negotiation/closing/escalated/closed/lost
  ADD COLUMN IF NOT EXISTS current_offer  NUMERIC,                  -- letztes Bot-Angebot
  ADD COLUMN IF NOT EXISTS agreed_price   NUMERIC,                  -- bei Einigung
  ADD COLUMN IF NOT EXISTS buyer_name     TEXT,
  ADD COLUMN IF NOT EXISTS buyer_email    TEXT,
  ADD COLUMN IF NOT EXISTS buyer_contact_phone TEXT,                -- vom Käufer genannte Rückrufnummer
  ADD COLUMN IF NOT EXISTS lead_flagged_at TIMESTAMPTZ;            -- wann als heißer Lead erkannt

-- ── Events-Protokoll ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cv_events (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT,
  slot_id      BIGINT,
  subscription_id BIGINT,
  type         TEXT NOT NULL,    -- hot_lead / callback / agreed / escalated / dossier_sent / lost
  buyer_phone  TEXT,
  payload      JSONB DEFAULT '{}'::jsonb,
  notified     BOOLEAN DEFAULT false,   -- ob Verkäufer schon informiert wurde (für Resend Schritt D)
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cv_events_slot    ON cv_events(slot_id);
CREATE INDEX IF NOT EXISTS idx_cv_events_type    ON cv_events(type);
CREATE INDEX IF NOT EXISTS idx_cv_events_created ON cv_events(created_at DESC);

-- ── Berechtigungen ──────────────────────────────────────────────
GRANT ALL PRIVILEGES ON cv_bot_sessions TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON cv_events        TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- ── Verifikation ────────────────────────────────────────────────
SELECT 'cv_bot_sessions.phase'  AS check_item,
       COUNT(*)::text           AS result
  FROM information_schema.columns
 WHERE table_name='cv_bot_sessions' AND column_name='phase'
UNION ALL
SELECT 'cv_events table', COUNT(*)::text
  FROM information_schema.tables
 WHERE table_name='cv_events';
