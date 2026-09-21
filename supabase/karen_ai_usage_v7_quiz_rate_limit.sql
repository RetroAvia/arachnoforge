-- =====================================================================
-- ArachnoForge — V37.0 "Governance dei costi AI, parte 2"
-- Nuova tabella: karen_ai_usage
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase dopo le migrazioni precedenti.
-- Idempotente: rieseguibile senza errori "already exists".
--
-- IL PROBLEMA CHE RISOLVE
-- Il briefing giornaliero era già protetto da un tetto
-- (MAX_FORCE_REGENERATIONS_PER_DAY, contato in karen_briefings.regen_count).
-- L'"Interrogazione K.A.R.E.N." (`mode: 'quiz'`) invece NON aveva alcun
-- limite: ogni click su "Preparala"/"Rigenera" è una chiamata Sonnet, il
-- pulsante è a portata di mano su ogni nodo completato, e nulla impediva
-- di premerlo cento volte di fila. Un contatore giornaliero chiude il
-- buco senza togliere nulla all'uso normale.
--
-- Perché una tabella a parte e non una colonna su karen_briefings: un
-- quiz può essere richiesto in un giorno in cui il briefing non è mai
-- stato generato, quindi la riga potrebbe non esistere. Questa tabella è
-- una pura contabilità di servizio, senza relazioni con il resto.
--
-- MODELLO DI SICUREZZA: nessun accesso dal client, in nessuna forma.
-- Solo la Service Role (l'Edge Function) legge e scrive — un contatore
-- di budget che l'utente può azzerare non è un contatore.
-- =====================================================================

create table if not exists public.karen_ai_usage (
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        date not null,
  -- Generazioni di "Interrogazione K.A.R.E.N." consumate in giornata.
  quiz_count  integer not null default 0 check (quiz_count >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists idx_karen_ai_usage_user_date
  on public.karen_ai_usage (user_id, date desc);

-- ---------------------------------------------------------------------
-- RLS — attiva, FORZATA, e senza NESSUNA policy: con RLS abilitata e
-- zero policy, ogni accesso da "anon" e "authenticated" è respinto di
-- default. La Service Role bypassa comunque la RLS per progetto.
-- ---------------------------------------------------------------------
alter table public.karen_ai_usage enable row level security;
alter table public.karen_ai_usage force row level security;

revoke all on public.karen_ai_usage from anon;
revoke all on public.karen_ai_usage from authenticated;

-- ---------------------------------------------------------------------
-- Incremento atomico. Farlo con un SELECT seguito da un UPDATE lato
-- Edge Function lascerebbe una finestra in cui due richieste
-- contemporanee leggono lo stesso valore e scrivono lo stesso +1: il
-- tetto si scavalcherebbe proprio sotto carico, cioè quando serve.
-- `ON CONFLICT DO UPDATE` lo rende una sola operazione atomica.
-- ---------------------------------------------------------------------
create or replace function public.bump_karen_quiz_usage(p_user_id uuid, p_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.karen_ai_usage (user_id, date, quiz_count, updated_at)
  values (p_user_id, p_date, 1, now())
  on conflict (user_id, date)
  do update set quiz_count = public.karen_ai_usage.quiz_count + 1,
                updated_at = now()
  returning quiz_count into new_count;
  return new_count;
end;
$$;

-- La funzione è SECURITY DEFINER ma non è raggiungibile dal client:
-- l'EXECUTE viene revocato esplicitamente a tutti tranne service_role.
revoke all on function public.bump_karen_quiz_usage(uuid, date) from public;
revoke all on function public.bump_karen_quiz_usage(uuid, date) from anon;
revoke all on function public.bump_karen_quiz_usage(uuid, date) from authenticated;
grant execute on function public.bump_karen_quiz_usage(uuid, date) to service_role;

-- ---------------------------------------------------------------------
-- Verifica finale (facoltativo — decommenta ed esegui a parte)
-- ---------------------------------------------------------------------
-- select relname, relrowsecurity, relforcerowsecurity
--   from pg_class where relname = 'karen_ai_usage';
--
-- select proname, prosecdef from pg_proc where proname = 'bump_karen_quiz_usage';
