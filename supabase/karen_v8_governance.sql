-- =====================================================================
-- ArachnoForge — V42 "Governance unica di K.A.R.E.N." (migrazione v8)
-- Contatori per ogni modalità + cache del bilancio settimanale
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase DOPO
-- supabase/karen_ai_usage_v7_quiz_rate_limit.sql.
-- Idempotente: rieseguibile senza errori "already exists".
--
-- COSA CAMBIA
-- 1. karen_ai_usage ha un contatore per OGNI ramo che chiama Claude:
--    prime generazioni del briefing (briefing), interrogazioni (quiz),
--    rigenerazioni manuali del briefing (regen), nuovi tentativi dopo un
--    briefing di ripiego (retry), interrogazione orale (oral), valutazione
--    delle risposte (oral_eval), bilancio della settimana (weekly). Li incrementa in modo ATOMICO una sola funzione,
--    bump_karen_usage(utente, giorno, tipo). Il giorno lo decide la Edge
--    Function (giorno UTC del server), mai la data mandata dal client:
--    cambiare la data del dispositivo non azzera più i tetti.
-- 2. karen_weekly conserva il bilancio della settimana, una riga per
--    settimana: richiederlo non costa una seconda chiamata a Claude.
--
-- MODELLO DI SICUREZZA (come la v7): nessun accesso dal client, in
-- nessuna forma. Solo la Service Role (la Edge Function) legge e scrive.
-- Un contatore di budget che l'utente può azzerare non è un contatore.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Contatori
-- ---------------------------------------------------------------------
alter table public.karen_ai_usage add column if not exists briefing_count  integer not null default 0;
alter table public.karen_ai_usage add column if not exists regen_count     integer not null default 0;
alter table public.karen_ai_usage add column if not exists retry_count     integer not null default 0;
alter table public.karen_ai_usage add column if not exists oral_count      integer not null default 0;
alter table public.karen_ai_usage add column if not exists oral_eval_count integer not null default 0;
alter table public.karen_ai_usage add column if not exists weekly_count    integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'karen_ai_usage_v8_counts_nonneg'
      and conrelid = 'public.karen_ai_usage'::regclass
  ) then
    alter table public.karen_ai_usage
      add constraint karen_ai_usage_v8_counts_nonneg
      check (briefing_count >= 0 and regen_count >= 0 and retry_count >= 0 and oral_count >= 0 and oral_eval_count >= 0 and weekly_count >= 0);
  end if;
end $$;

-- Incremento atomico: `ON CONFLICT DO UPDATE` fa lettura e scrittura in
-- una sola operazione, così due richieste contemporanee non leggono lo
-- stesso valore scavalcando il tetto proprio sotto doppio click.
create or replace function public.bump_karen_usage(p_user_id uuid, p_date date, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  if p_kind is null or p_kind not in ('briefing', 'quiz', 'regen', 'retry', 'oral', 'oral_eval', 'weekly') then
    raise exception 'bump_karen_usage: tipo di contatore sconosciuto (%)', p_kind using errcode = '22023';
  end if;

  insert into public.karen_ai_usage as u
    (user_id, date, briefing_count, quiz_count, regen_count, retry_count, oral_count, oral_eval_count, weekly_count, updated_at)
  values
    (p_user_id, p_date,
     (p_kind = 'briefing')::int, (p_kind = 'quiz')::int, (p_kind = 'regen')::int, (p_kind = 'retry')::int,
     (p_kind = 'oral')::int, (p_kind = 'oral_eval')::int, (p_kind = 'weekly')::int,
     now())
  on conflict (user_id, date) do update set
    briefing_count  = u.briefing_count  + (p_kind = 'briefing')::int,
    quiz_count      = u.quiz_count      + (p_kind = 'quiz')::int,
    regen_count     = u.regen_count     + (p_kind = 'regen')::int,
    retry_count     = u.retry_count     + (p_kind = 'retry')::int,
    oral_count      = u.oral_count      + (p_kind = 'oral')::int,
    oral_eval_count = u.oral_eval_count + (p_kind = 'oral_eval')::int,
    weekly_count    = u.weekly_count    + (p_kind = 'weekly')::int,
    updated_at      = now()
  returning
    case p_kind
      when 'briefing'  then u.briefing_count
      when 'quiz'      then u.quiz_count
      when 'regen'     then u.regen_count
      when 'retry'     then u.retry_count
      when 'oral'      then u.oral_count
      when 'oral_eval' then u.oral_eval_count
      else                  u.weekly_count
    end
  into new_count;

  return new_count;
end;
$$;

-- SECURITY DEFINER ma irraggiungibile dal client: EXECUTE solo alla Service Role.
revoke all on function public.bump_karen_usage(uuid, date, text) from public;
revoke all on function public.bump_karen_usage(uuid, date, text) from anon;
revoke all on function public.bump_karen_usage(uuid, date, text) from authenticated;
grant execute on function public.bump_karen_usage(uuid, date, text) to service_role;

-- ---------------------------------------------------------------------
-- 2. Bilancio della settimana
-- ---------------------------------------------------------------------
create table if not exists public.karen_weekly (
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Il lunedì della settimana (data locale del Cadetto).
  week_start  date not null,
  -- { sintesi, bene[], migliorare[], tecnica{nome,come}, prossima_settimana[{materia_id, azione}] }
  payload     jsonb not null,
  model       text,
  -- Generato a settimana CHIUSA (data locale del Cadetto)? Solo allora è
  -- definitivo; uno fatto a metà settimana si rifà quando la settimana finisce.
  week_closed boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.karen_weekly add column if not exists week_closed boolean not null default false;

create index if not exists idx_karen_weekly_user_week
  on public.karen_weekly (user_id, week_start desc);

-- RLS attiva, FORZATA e senza policy: anon e authenticated respinti di
-- default; la Service Role la bypassa per progetto.
alter table public.karen_weekly enable row level security;
alter table public.karen_weekly force row level security;

revoke all on public.karen_weekly from anon;
revoke all on public.karen_weekly from authenticated;
grant select, insert, update, delete on public.karen_weekly to service_role;

-- ---------------------------------------------------------------------
-- Verifica finale (facoltativo — decommenta ed esegui a parte)
-- ---------------------------------------------------------------------
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'karen_ai_usage' order by ordinal_position;
--
-- select relname, relrowsecurity, relforcerowsecurity
--   from pg_class where relname in ('karen_ai_usage', 'karen_weekly');
--
-- select proname, prosecdef from pg_proc where proname in ('bump_karen_usage', 'bump_karen_quiz_usage');
