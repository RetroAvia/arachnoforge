-- =====================================================================
-- ArachnoForge — Biometric Suit HUD & K.A.R.E.N. AI Engine (Fase 5)
-- Migrazione incrementale: karen_briefings — Governance rigenerazioni
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase DOPO
-- supabase/suit_telemetry_schema.sql (Fase 1),
-- supabase/suit_telemetry_schema_v2_subjective_metrics.sql (Fase 3) e
-- supabase/suit_telemetry_schema_v3_daily_brain.sql (Fase 4).
-- Idempotente come i file precedenti — rieseguibile senza errori.
--
-- COSA CAMBIA: karen-oracle (v4, "Blindatura & Governance") introduce un
-- tetto giornaliero alle rigenerazioni manuali (`force: true`) per
-- proteggere il budget da un utente che premesse ripetutamente "Rigenera
-- Diagnostica". Questa migrazione aggiunge SOLO il contatore che rende
-- possibile applicare quel tetto: nessuna tabella nuova, nessuna
-- riscrittura delle righe esistenti (il default 0 copre i briefing già
-- salvati prima di questa migrazione — vengono trattati come "zero
-- rigenerazioni finora", corretto perché non esisteva ancora un
-- conteggio). Il contatore si azzera naturalmente ogni giorno perché
-- karen_briefings è già chiavata per user_id+date: una nuova data è
-- sempre una nuova riga con regen_count di default — nessun cron di
-- reset necessario.
-- =====================================================================

alter table public.karen_briefings
  add column if not exists regen_count integer not null default 0;

-- Nessuna modifica a RLS/GRANT: `regen_count` è una colonna aggiuntiva
-- sulla stessa tabella già coperta dalle policy riga-based esistenti
-- (karen_briefings è SELECT-only per "authenticated", scritture solo via
-- Service Role — vedi supabase/suit_telemetry_schema.sql) — nessuna
-- policy nuova richiesta per una colonna, solo per una tabella.

-- ---------------------------------------------------------------------
-- Verifica finale (facoltativo)
-- ---------------------------------------------------------------------
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'karen_briefings'
--   order by ordinal_position;
