-- =====================================================================
-- ArachnoForge — V37.0 "Blindatura della concorrenza"
-- Migrazione incrementale: public.user_data — colonna updated_at
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase DOPO supabase/rls_user_data.sql.
-- Idempotente come tutti i file precedenti: rieseguibile senza errori.
--
-- IL PROBLEMA CHE RISOLVE
-- Ogni salvataggio dell'app è un upsert dell'INTERO `app_state`, e fino
-- alla V36 non esisteva alcun modo di accorgersi che quella riga fosse
-- cambiata nel frattempo. Con il telefono e il PC aperti insieme —
-- cioè il caso normale per una PWA installata — l'ultimo dispositivo che
-- scriveva cancellava in silenzio il lavoro dell'altro. Nessun errore,
-- nessun avviso: i dati sparivano e basta.
--
-- `updated_at` dà al client un token di versione da confrontare: la
-- scrittura diventa condizionale (`.eq('updated_at', <visto al boot>)`)
-- e, se la riga è cambiata sotto, l'update tocca ZERO righe invece di
-- sovrascrivere. Il client se ne accorge e chiede al Cadetto quale
-- versione tenere, invece di decidere da solo e perdere qualcosa.
--
-- Nessuna modifica a RLS/GRANT: `updated_at` è una colonna aggiuntiva su
-- una tabella già coperta dalle policy riga-based esistenti.
-- =====================================================================

alter table public.user_data
  add column if not exists updated_at timestamptz not null default now();

-- Le righe già esistenti ricevono `now()` dal default: corretto, perché
-- il client legge comunque il valore al boot prima di poterlo usare come
-- guardia. Nessuna riscrittura retroattiva necessaria.

-- La funzione set_updated_at() è già stata creata da
-- supabase/suit_telemetry_schema.sql; `create or replace` la rende
-- indipendente dall'ordine di esecuzione dei file.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_data_updated_at on public.user_data;
create trigger trg_user_data_updated_at
  before update on public.user_data
  for each row execute function public.set_updated_at();

-- Nota: il trigger scatta su UPDATE, non su INSERT — l'INSERT prende già
-- il default `now()`. È quello che serve: il token cambia ad ogni
-- scrittura reale, mai per una semplice lettura.

-- ---------------------------------------------------------------------
-- Verifica finale (facoltativo — decommenta ed esegui a parte)
-- ---------------------------------------------------------------------
-- select column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'user_data'
--   order by ordinal_position;
--
-- select tgname from pg_trigger where tgrelid = 'public.user_data'::regclass;
