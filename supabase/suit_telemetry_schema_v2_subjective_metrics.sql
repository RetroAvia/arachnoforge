-- =====================================================================
-- ArachnoForge — Biometric Suit HUD & K.A.R.E.N. AI Engine (Fase 3)
-- Migrazione incrementale: cadet_subjective_logs — metriche estese
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase DOPO supabase/suit_telemetry_schema.sql
-- (Fase 1). Idempotente come i file precedenti — rieseguibile senza errori.
--
-- COSA CAMBIA: la Quick Log del Cadetto (Fase 2) usava un'unica coppia
-- focus_level/mood. La Fase 3 la sostituisce, nell'UI e nell'algoritmo di
-- Readiness, con 4 assi distinti — focus, energia, stress, indolenzimento
-- muscolare — più fedeli a un vero survey di recovery (stile
-- Whoop/Oura). Le colonne "mood" e "caffeine_mg" NON vengono rimosse:
-- restano lette come fallback per compatibilità con eventuali righe
-- storiche già salvate in Fase 2 (vedi commento in karen-oracle/index.ts,
-- funzione scoreSubjective) — nessuna perdita di dati, nessun breaking
-- change sullo schema esistente.
-- =====================================================================

alter table public.cadet_subjective_logs
  add column if not exists energy_level smallint,
  add column if not exists stress_level smallint,
  add column if not exists muscle_soreness smallint;

-- I CHECK constraint si aggiungono in blocchi DO separati (idempotenti):
-- "ADD COLUMN ... CHECK" inline non è idempotente quanto un DO esplicito
-- con IF NOT EXISTS sul nome del vincolo, stessa convenzione già usata
-- per gli UNIQUE in suit_telemetry_schema.sql.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cadet_subjective_logs_energy_level_check'
      and conrelid = 'public.cadet_subjective_logs'::regclass
  ) then
    alter table public.cadet_subjective_logs
      add constraint cadet_subjective_logs_energy_level_check
      check (energy_level is null or energy_level between 1 and 10);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cadet_subjective_logs_stress_level_check'
      and conrelid = 'public.cadet_subjective_logs'::regclass
  ) then
    alter table public.cadet_subjective_logs
      add constraint cadet_subjective_logs_stress_level_check
      check (stress_level is null or stress_level between 1 and 10);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cadet_subjective_logs_muscle_soreness_check'
      and conrelid = 'public.cadet_subjective_logs'::regclass
  ) then
    alter table public.cadet_subjective_logs
      add constraint cadet_subjective_logs_muscle_soreness_check
      check (muscle_soreness is null or muscle_soreness between 1 and 10);
  end if;
end $$;

-- Nessuna modifica a RLS/GRANT: le policy esistenti (suit_biometrics_*,
-- cadet_subjective_logs_*, karen_briefings_*) sono a livello di RIGA, non
-- di colonna — restano valide automaticamente anche per le 3 colonne
-- nuove, senza bisogno di ricrearle.

-- ---------------------------------------------------------------------
-- Verifica finale (facoltativo)
-- ---------------------------------------------------------------------
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'cadet_subjective_logs'
--   order by ordinal_position;
