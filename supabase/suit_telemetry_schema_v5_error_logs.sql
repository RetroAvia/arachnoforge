-- =====================================================================
-- ArachnoForge — Osservabilità di base (Fase 5, "Blindatura & Governance")
-- Nuova tabella: client_error_logs
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase, dopo tutte le migrazioni
-- precedenti. Idempotente come i file precedenti — rieseguibile senza
-- errori "already exists".
--
-- COSA CAMBIA: l'app non aveva finora ALCUNA osservabilità in produzione
-- — un errore di rendering o un rifiuto di Promise non gestito spariva
-- nella console del browser dell'utente, mai visibile a chi manutiene
-- ArachnoForge. Niente SDK di terze parti (Sentry e simili) — nessun
-- accesso npm/vendor esterno disponibile in questo giro di lavoro —
-- quindi si riusa l'infrastruttura già presente (Supabase + client
-- esistente): una tabella dedicata, sola-scrittura per il client,
-- leggibile solo da chi ha accesso al progetto Supabase (Table Editor)
-- o alla Service Role Key.
--
-- COMPARTIMENTI STAGNI: come le 3 tabelle biometriche, `client_error_logs`
-- è isolata dal Cloud State (`user_data`) — nessuna FK verso di esso,
-- nessuna lettura da parte del resto dell'app. `user_id` è nullable
-- perché un errore può verificarsi PRIMA del login (es. sul Nexus Gate).
--
-- MODELLO DI SICUREZZA (asimmetrico e deliberato, come karen_briefings):
--   - "authenticated" può SOLO inserire le proprie righe (user_id deve
--     combaciare col proprio auth.uid(), oppure essere NULL). Nessun
--     SELECT/UPDATE/DELETE concesso: un client non deve mai poter leggere
--     (né tantomeno alterare o cancellare) i log di errore, propri o
--     altrui — sono un registro diagnostico per chi mantiene l'app, non
--     un dato che l'utente deve vedere in UI.
--   - "anon" non ha alcun accesso: un errore prima del login viene
--     comunque attribuito a un utente autenticato appena possibile lato
--     client (il reporter tenta sempre prima di leggere la sessione);
--     se proprio non c'è alcuna sessione, l'errore resta solo in console,
--     mai perso in modo grave (nessuna funzionalità critica dipende da
--     questa tabella).
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.client_error_logs (
  id                uuid primary key default gen_random_uuid(),
  -- Nullable: un errore puo' verificarsi prima del login (Nexus Gate).
  -- on delete set null (non cascade): cancellare un account non deve mai
  -- far sparire lo storico diagnostico degli errori che ha causato.
  user_id           uuid references auth.users (id) on delete set null,
  -- Da dove arriva il report — vedi src/utils/errorReporter.js:
  -- 'react-error-boundary' | 'window-onerror' | 'unhandledrejection'.
  source            text not null,
  message           text not null,
  stack             text,
  component_stack   text,
  -- Percorso (hash-route) e User-Agent al momento dell'errore — utili per
  -- capire "su quale pagina" e "con quale browser", mai dati sensibili.
  page_path         text,
  user_agent        text,
  -- Contesto libero aggiuntivo (es. { appVersion, viewport }), mai PII.
  extra             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_client_error_logs_created_at
  on public.client_error_logs (created_at desc);

create index if not exists idx_client_error_logs_user_id
  on public.client_error_logs (user_id);


-- ---------------------------------------------------------------------
-- RLS — attivazione + FORCE
-- ---------------------------------------------------------------------
alter table public.client_error_logs enable row level security;
alter table public.client_error_logs force row level security;


-- ---------------------------------------------------------------------
-- GRANT di tabella (valutati PRIMA delle policy RLS)
-- ---------------------------------------------------------------------
revoke all on public.client_error_logs from anon;
revoke all on public.client_error_logs from authenticated;
-- Solo INSERT per "authenticated" — nessun SELECT/UPDATE/DELETE, vedi
-- nota sicurezza in testa al file.
grant insert on public.client_error_logs to authenticated;


-- ---------------------------------------------------------------------
-- POLICY — client_error_logs (INSERT-only, propria riga o user_id NULL)
-- ---------------------------------------------------------------------
drop policy if exists "client_error_logs_insert_own" on public.client_error_logs;
create policy "client_error_logs_insert_own"
  on public.client_error_logs for insert
  to authenticated
  with check (auth.uid() = user_id or user_id is null);

-- Nessuna policy SELECT/UPDATE/DELETE per "authenticated" o "anon": con
-- RLS attiva e nessuna policy per quei comandi, sono respinti di default.
-- La Service Role Key (Supabase Studio, script di manutenzione) bypassa
-- comunque la RLS per progetto — nessuna policy dedicata necessaria.


-- ---------------------------------------------------------------------
-- Verifica finale (facoltativo — decommenta ed esegui a parte)
-- ---------------------------------------------------------------------
-- select relname, relrowsecurity, relforcerowsecurity
--   from pg_class
--   where relname = 'client_error_logs';
--
-- select tablename, policyname, cmd, roles
--   from pg_policies
--   where tablename = 'client_error_logs';
