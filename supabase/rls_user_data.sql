-- =====================================================================
-- ArachnoForge — Row Level Security su public.user_data
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase (Project -> SQL Editor -> New
-- query), una sola volta. Lo script è idempotente: puoi rieseguirlo in
-- sicurezza senza generare errori "already exists".
--
-- Cosa garantisce, alla fine:
--   - Ogni utente autenticato può leggere/creare/aggiornare SOLO la riga
--     con user_id = al proprio auth.uid() — mai i dati di un altro utente.
--   - Il ruolo "anon" (nessuna sessione attiva) non può leggere né
--     scrivere NULLA sulla tabella — coerente col fatto che l'app non
--     interroga mai Supabase in Modalità Ospite/Sandbox (100% locale).
--   - Nessuna riga è mai eliminabile via API pubblica (l'app non elimina
--     mai user_data: nessuna policy DELETE = DELETE bloccato di default
--     una volta attivata la RLS).
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 0 — Prerequisiti strutturali
-- ---------------------------------------------------------------------
-- L'app usa supabase.from('user_data').upsert({ user_id, app_state },
-- { onConflict: 'user_id' }) — Postgres richiede un vincolo UNIQUE (o una
-- PRIMARY KEY) sulla colonna user_id perché "onConflict" sappia su quale
-- indice risolvere il conflitto. Se la tabella è stata creata dalla UI di
-- Supabase con user_id come colonna semplice, questo vincolo potrebbe
-- mancare: il blocco seguente lo aggiunge solo se non esiste già.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_data_user_id_key'
      AND conrelid = 'public.user_data'::regclass
  ) THEN
    ALTER TABLE public.user_data
      ADD CONSTRAINT user_data_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- Foreign key verso auth.users: se l'account viene eliminato, la riga
-- user_data collegata sparisce automaticamente (nessun record orfano).
-- Anche questo blocco è no-op se il vincolo esiste già.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_data_user_id_fkey'
      AND conrelid = 'public.user_data'::regclass
  ) THEN
    ALTER TABLE public.user_data
      ADD CONSTRAINT user_data_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- STEP 1 — Attiva la Row Level Security
-- ---------------------------------------------------------------------
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- FORCE RLS: applica le policy anche alle query eseguite con il ruolo
-- proprietario della tabella (non solo anon/authenticated). Il client
-- pubblico (supabase-js con anon key) non usa mai il ruolo owner, quindi
-- questa riga è un rinforzo difensivo extra, non strettamente necessaria
-- per il funzionamento dell'app.
ALTER TABLE public.user_data FORCE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------
-- STEP 2 — Privilegi a livello di tabella
-- ---------------------------------------------------------------------
-- Postgres controlla PRIMA i GRANT di tabella e SOLO DOPO le policy RLS:
-- senza questi GRANT, le policy sottostanti non avrebbero alcun effetto
-- perché la query verrebbe già respinta a monte (o, peggio, se i GRANT
-- di default di Supabase fossero più larghi del previsto, "anon" potrebbe
-- avere accesso a livello di tabella che le sole policy non basterebbero
-- a bloccare). Qui il permesso è esplicito e minimale:
--   - "authenticated" (utenti loggati) -> select, insert, update.
--   - "anon" (nessuna sessione) -> nessun permesso, la Modalità Ospite/
--     Sandbox dell'app non tocca mai questa tabella.
REVOKE ALL ON public.user_data FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.user_data TO authenticated;


-- ---------------------------------------------------------------------
-- STEP 3 — Policy: SELECT
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "user_data_select_own" ON public.user_data;
CREATE POLICY "user_data_select_own"
  ON public.user_data
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
  );


-- ---------------------------------------------------------------------
-- STEP 4 — Policy: INSERT
-- ---------------------------------------------------------------------
-- WITH CHECK (non USING) perché su INSERT non esiste ancora una riga
-- "esistente" da confrontare: si valida solo la riga che si sta per
-- scrivere — deve avere user_id = auth.uid() del chiamante, mai un id
-- arbitrario passato dal client.
DROP POLICY IF EXISTS "user_data_insert_own" ON public.user_data;
CREATE POLICY "user_data_insert_own"
  ON public.user_data
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
  );


-- ---------------------------------------------------------------------
-- STEP 5 — Policy: UPDATE
-- ---------------------------------------------------------------------
-- USING blocca quali righe ESISTENTI sono raggiungibili (solo la propria);
-- WITH CHECK blocca il valore RISULTANTE dopo l'update (impedisce anche
-- di riassegnare user_id a un id diverso dal proprio in un update malevolo).
DROP POLICY IF EXISTS "user_data_update_own" ON public.user_data;
CREATE POLICY "user_data_update_own"
  ON public.user_data
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
  );

-- Nessuna policy DELETE viene creata: con la RLS attiva e nessuna policy
-- per il comando DELETE, ogni tentativo di cancellazione via API pubblica
-- è respinto di default — coerente con l'app, che non elimina mai una
-- riga di user_data (il "Reset totale" in Karen OS Settings sovrascrive
-- lo stato con i valori di default, non cancella la riga).


-- ---------------------------------------------------------------------
-- STEP 6 — Verifica finale (facoltativo)
-- ---------------------------------------------------------------------
-- Esegui questa query per controllare a colpo d'occhio che tutto sia
-- attivo: rowsecurity deve risultare "true" e devono comparire le 3
-- policy appena create.
-- SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class WHERE relname = 'user_data';
--
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE tablename = 'user_data';
