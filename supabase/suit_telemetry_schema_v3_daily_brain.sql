-- =====================================================================
-- ArachnoForge — Biometric Suit HUD & K.A.R.E.N. AI Engine (Fase 4)
-- Migrazione incrementale: karen_briefings — Daily Brain "directives"
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase DOPO
-- supabase/suit_telemetry_schema.sql (Fase 1) e
-- supabase/suit_telemetry_schema_v2_subjective_metrics.sql (Fase 3).
-- Idempotente come i file precedenti — rieseguibile senza errori.
--
-- COSA CAMBIA: karen-oracle (v3, "Daily Brain") continua a fare UNA sola
-- chiamata Claude al giorno per utente — stesso identico lifecycle di
-- cache/force già in produzione — ma il JSON richiesto al modello cresce
-- da {briefing_text, tactical_advice} a un payload esteso che include
-- anche le direttive operative pervasive ({mission_control, focus_timer,
-- study_window}). Questa migrazione aggiunge SOLO la colonna che le
-- ospita: nessuna tabella nuova, nessuna riscrittura delle righe
-- esistenti (il default '{}'::jsonb copre i briefing già salvati prima
-- di questa migrazione, che semplicemente non avranno ancora direttive
-- finché non vengono rigenerati).
-- =====================================================================

alter table public.karen_briefings
  add column if not exists directives jsonb not null default '{}'::jsonb;

-- Nessuna modifica a RLS/GRANT: `directives` è una colonna aggiuntiva
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
