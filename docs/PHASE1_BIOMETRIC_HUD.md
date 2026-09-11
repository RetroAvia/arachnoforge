# ArachnoForge — Biometric Suit HUD & K.A.R.E.N. AI Engine — Fase 1

Guida operativa per: schema database, pipeline di ingestione iOS -> Supabase, deploy dell'Edge Function `karen-oracle`.

File correlati in questo repo:
- `supabase/suit_telemetry_schema.sql` — schema + RLS (esegui nel SQL Editor di Supabase)
- `supabase/functions/karen-oracle/index.ts` — Edge Function

---

## 1. Esegui lo schema SQL

Supabase Dashboard -> **SQL Editor** -> New query -> incolla il contenuto di `supabase/suit_telemetry_schema.sql` -> Run. È idempotente, puoi rieseguirlo senza rischi.

Verifica rapida in fondo al file (query commentate) per controllare che RLS sia attiva e le policy siano presenti.

---

## 2. Genera un token di lunga durata per l'automazione iOS

Un Comando Rapido che gira in automatico ogni mattina **non può fare login interattivo** né gestire il refresh del JWT di sessione (che scade dopo ~1 ora). Serve quindi un token "macchina" che:

- rispetti comunque la RLS (`role: authenticated`, `sub` = il tuo UUID utente) — mai la Service Role Key, che bypasserebbe tutte le policy e avrebbe accesso illimitato al database se il telefono venisse compromesso;
- non scada per anni, così lo configuri una volta sola.

### 2.1 Recupera i due valori che ti servono

1. **JWT Secret del progetto**: Supabase Dashboard -> Project Settings -> API -> sezione "JWT Settings" -> `JWT Secret`. (Il tuo progetto usa già un anon key in formato JWT classico in `src/utils/supabaseClient.js`, quindi questo pannello è disponibile.)
2. **Il tuo UUID utente**: Supabase Dashboard -> Authentication -> Users -> clicca sul tuo account -> copia lo `UID`.

### 2.2 Genera il token (una tantum, in locale)

```bash
npm install jsonwebtoken --no-save
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'INCOLLA_IL_TUO_UUID', role: 'authenticated', aud: 'authenticated' },
  'INCOLLA_IL_JWT_SECRET',
  { expiresIn: '3650d' }
);
console.log(token);
"
```

Copia l'output: è la stringa che userai come `Authorization: Bearer <...>` nel Comando Rapido.

**Trattalo come una password permanente al tuo account** (è comunque limitato dalla RLS alle sole tue righe, mai a quelle di altri utenti). Non committarlo mai nel repository, non condividerlo. Per revocarlo in futuro l'unica via è ruotare il JWT Secret del progetto (Project Settings -> API) — operazione drastica che invalida ANCHE tutte le sessioni normali dell'app, quindi usala solo se il token viene compromesso.

---

## 3. Pipeline di ingestione — Apple Health -> Supabase

### Opzione A — consigliata: app "Health Auto Export"

I Comandi Rapidi nativi possono leggere frequenza cardiaca, passi e calorie attive senza problemi, ma la scomposizione del sonno in fasi (Core/Deep/REM) tramite le sole azioni Salute è fragile e cambia comportamento tra versioni di iOS. L'app **Health Auto Export - JSON+CSV** (App Store) espone già tutte queste metriche scomposte e include un'automazione "REST API" che invia una richiesta HTTP schedulata senza passare da Comandi Rapidi:

1. Health Auto Export -> **Automations** -> New -> **REST API**.
2. Metodo: `POST`. URL:
   ```
   https://<PROJECT_REF>.supabase.co/rest/v1/suit_biometrics?on_conflict=user_id,date
   ```
3. Headers:
   | Header | Valore |
   |---|---|
   | `apikey` | la tua `SUPABASE_ANON_KEY` (da `src/utils/supabaseClient.js`) |
   | `Authorization` | `Bearer <token generato al punto 2>` |
   | `Content-Type` | `application/json` |
   | `Prefer` | `resolution=merge-duplicates,return=minimal` |
4. Seleziona le metriche: Sleep Analysis (Total/Deep/REM), Resting Heart Rate, Steps, Active Energy.
5. Nella sezione di mapping del body, costruisci il JSON esattamente come nello schema del punto 4 qui sotto (l'app permette di rinominare le chiavi esportate per farle combaciare 1:1).
6. Frequenza: giornaliera, es. ogni mattina alle 07:00.

### Opzione B — solo Comandi Rapidi nativi (fai-da-te, senza app terze)

Fattibile per battito a riposo / passi / calorie attive; per il sonno per fasi è più laboriosa (vedi nota sotto). Crea un'**Automazione Personale** (non "Comando Rapido" normale, ma "Automazione" -> "Ora del giorno") in modo che parta da sola ogni mattina:

1. **Impostazioni Comandi Rapidi** app -> tab **Automazione** -> `+` -> **Crea automazione personale** -> **Ora del giorno** (es. 07:00, ripeti ogni giorno) -> **Avanti**.
2. Disattiva "Chiedi prima di eseguire" (altrimenti richiede conferma manuale ogni volta e non parte davvero in background).
3. Aggiungi le azioni:
   - **Data e ora** -> formatta come `AAAA-MM-GG` -> salva in variabile `DataOggi`.
   - **Trova campioni sanitari** (o "Recupera campione sanitario" a seconda della versione iOS) -> Tipo: *Frequenza cardiaca a riposo* -> Intervallo: ultimo giorno -> Ordina per più recente, limite 1 -> estrai il valore numerico -> variabile `RestingHR`.
   - **Trova campioni sanitari** -> Tipo: *Conteggio passi* -> Intervallo: oggi -> Somma -> variabile `Passi`.
   - **Trova campioni sanitari** -> Tipo: *Energia attiva* -> Intervallo: oggi -> Somma -> variabile `CalorieAttive`.
   - *(Sonno, opzionale/fragile)* **Trova campioni sanitari** -> Tipo: *Analisi del sonno* -> Intervallo: ultime 24 ore -> **Ripeti per ogni elemento** -> dentro il ciclo, un blocco **Se** sul valore del campione (`In Sonno: Core` / `Profondo` / `REM` / `Sveglio` / `A letto`) che accumula in variabili separate `SonnoCoreMin`, `SonnoDeepMin`, `SonnoRemMin` la differenza in minuti fra Inizio e Fine del campione. È l'azione più delicata dell'intero Comando: se i nomi dei valori non combaciano esattamente con quelli restituiti dal tuo iPhone, i minuti restano a zero. Se preferisci non combattere con questo passaggio, usa l'Opzione A solo per il sonno e i Comandi Rapidi nativi per il resto.
4. **Dizionario** -> costruisci le coppie chiave/valore esattamente come nello schema payload sotto.
5. **Contenuto URL** (Get Contents of URL):
   - URL: `https://<PROJECT_REF>.supabase.co/rest/v1/suit_biometrics?on_conflict=user_id,date`
   - Metodo: `POST`
   - Intestazioni: le 4 della tabella sopra
   - Corpo della richiesta: **JSON**, valore = il Dizionario costruito al passo 4.
6. Salva, disattiva ulteriormente qualsiasi conferma residua, testa con "Esegui" manuale prima di fidarti dell'automazione.

### 3.1 Payload JSON esatto atteso da `suit_biometrics`

```json
{
  "user_id": "IL_TUO_UUID_UTENTE",
  "date": "2026-09-11",
  "sleep_total_min": 432,
  "sleep_deep_min": 78,
  "sleep_rem_min": 95,
  "resting_hr": 58,
  "steps": 6421,
  "active_calories": 340,
  "raw_data": { "source": "apple_health_shortcuts" }
}
```

`user_id` deve combaciare esattamente con il `sub` incastonato nel token del punto 2 — la policy RLS `suit_biometrics_insert_own` blocca qualunque altro valore. Qualsiasi campo biometrico che non riesci a popolare puoi ometterlo (o mandare `null`): il Readiness Score in `karen-oracle` degrada con grazia sui dati mancanti invece di fallire.

### 3.2 Test rapido da terminale prima di fidarti di Shortcuts

```bash
curl -i -X POST "https://<PROJECT_REF>.supabase.co/rest/v1/suit_biometrics?on_conflict=user_id,date" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <TOKEN_LUNGA_DURATA>" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=representation" \
  -d '{"user_id":"IL_TUO_UUID","date":"2026-09-11","resting_hr":58,"steps":6421,"active_calories":340,"raw_data":{"source":"curl-test"}}'
```

Risposta attesa: `201 Created` (o `200` in caso di merge) con la riga salvata nel body.

---

## 4. Deploy dell'Edge Function `karen-oracle`

```bash
# Una tantum
supabase login
supabase link --project-ref <PROJECT_REF>

# Secrets — MAI nel frontend, MAI in un file .env committato
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set ANTHROPIC_MODEL=claude-3-5-haiku-latest   # opzionale, è già il default nel codice dalla Fase 4 ("Daily Brain") — vedi docs/PHASE4_DAILY_BRAIN.md

# Deploy
supabase functions deploy karen-oracle
```

### 4.1 Test manuale della function

Con lo stesso token generato al punto 2 (o con un vero token di sessione da login normale — la function accetta entrambi, verifica solo che sia un JWT valido di un utente `authenticated`):

```bash
curl -i -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/karen-oracle" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-09-11"}'
```

Risposta attesa (dalla Fase 4 in poi, `briefing.directives` è sempre presente — vedi `docs/PHASE4_DAILY_BRAIN.md`):

```json
{
  "briefing": {
    "id": "...",
    "user_id": "...",
    "date": "2026-09-11",
    "readiness_score": 72,
    "briefing_text": "...",
    "tactical_advice": "...",
    "score_breakdown": { "...": "..." },
    "directives": {
      "mission_control": { "load_adjustment_pct": -10, "rationale": "..." },
      "focus_timer": { "focus_minutes": 25, "break_minutes": 5, "preset_label": "25/5 — Standard", "rationale": "..." },
      "study_window": { "start_hour": 15, "end_hour": 18, "label": "15:00–18:00", "rationale": "..." }
    },
    "created_at": "..."
  },
  "readiness_band": "ATTENZIONE"
}
```

### 4.2 Automatizzare la generazione giornaliera (opzionale)

Per non dipendere dall'apertura dell'app per generare il briefing, puoi schedulare la chiamata alla function ogni mattina con **pg_cron + pg_net** (entrambe le estensioni si abilitano da Database -> Extensions nel Dashboard):

```sql
select cron.schedule(
  'karen-oracle-daily',
  '0 6 * * *',  -- 06:00 UTC ogni giorno — adatta al tuo fuso
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/karen-oracle',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <TOKEN_LUNGA_DURATA>',
      'apikey', '<SUPABASE_ANON_KEY>',
      'Content-Type', 'application/json'
    ),
    -- Timezone Trap (fix Fase 3): now() e' in UTC lato database — a
    -- ridosso della mezzanotte locale produrrebbe la data SBAGLIATA.
    -- karen-oracle dalla v2 rifiuta comunque richieste senza 'date'
    -- esplicito (400), quindi qui e' obbligatorio calcolarla nel fuso
    -- orario reale del Cadetto, non in UTC.
    body := jsonb_build_object(
      'date', to_char(now() AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD'),
      'force', false
    )
  );
  $$
);
```

Non obbligatorio per la Fase 1: il frontend della Fase 2 potrà semplicemente invocare `karen-oracle` al primo caricamento del Terminale se il briefing del giorno non esiste ancora.

---

## 5. Checklist prima di passare alla Fase 2

- [ ] Schema eseguito, RLS verificata (query di controllo in fondo al file `.sql`).
- [ ] Token di lunga durata generato e testato via `curl` su `suit_biometrics`.
- [ ] Almeno una riga reale in `suit_biometrics` per la data odierna.
- [ ] `karen-oracle` deployata, secrets impostati, risposta 200 testata via `curl`.
- [ ] Una riga presente in `karen_briefings` dopo il test.

Quando questi 5 punti sono verdi, sei pronto per la Fase 2: `SuitTelemetryView.jsx` + i punti di innesto in Sidebar/Terminale.
