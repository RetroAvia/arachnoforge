# ArachnoForge — K.A.R.E.N. "Daily Brain" — Fase 4

Guida operativa per la Fase 4: estensione dell'unica chiamata Claude giornaliera già esistente (`karen-oracle`) in un payload di direttive operative consumato pervasivamente da tutta la piattaforma — mai una nuova chiamata AI, mai una nuova pagina.

File correlati in questo repo:
- `supabase/suit_telemetry_schema_v3_daily_brain.sql` — migrazione (nuova colonna `directives` su `karen_briefings`)
- `supabase/functions/karen-oracle/index.ts` — Edge Function estesa
- `src/context/KarenBrainContext.jsx` — Provider condiviso lato client
- `src/context/ArachnoForgeContext.jsx` — consumo di `directives.focus_timer` per il Focus Timer Adattivo
- `src/App.jsx`, `src/pages/MissionControl.jsx`, `src/modules/suit-telemetry/SuitTelemetryView.jsx`, `src/components/Sidebar.jsx`, `src/pages/CoreConfig.jsx` — superfici pervasive

---

## 1. Cosa cambia, e cosa NON cambia

**Non cambia:** il lifecycle di cache/force di `karen-oracle` (una sola chiamata Claude per utente/giorno, `force: true` per rigenerare, fallback deterministico se il parsing fallisce), la separazione "compartimenti stagni" fra le 3 tabelle biometriche e il Cloud State principale (`user_data`), lo schema delle 3 tabelle esistenti.

**Cambia:**
1. Il JSON richiesto a Claude cresce da `{briefing_text, tactical_advice}` a un payload che include anche `directives`: `{mission_control, focus_timer, study_window}` — generato nella STESSA chiamata, zero costo aggiuntivo.
2. Il modello di default passa da `claude-sonnet-5` a **`claude-3-5-haiku-latest`** — una chiamata/utente/giorno con `max_tokens: 700`, ben dentro un budget dell'ordine di qualche euro al mese anche con centinaia di utenti attivi.
3. `karen_briefings` guadagna una colonna `directives jsonb not null default '{}'::jsonb` (migrazione v3).
4. Lato client, `useSuitTelemetry` non viene più montato due volte in modo indipendente (prima: `MissionControl.jsx` e `SuitTelemetryView.jsx` separatamente) — un solo `KarenBrainProvider`, montato in `App.jsx` come antenato di `ArachnoForgeProvider`, alimenta entrambe le pagine più il Focus Timer Adattivo nel Cloud State.

---

## 2. Deploy

```bash
# Se non già fatto per la Fase 1/3
supabase secrets set ANTHROPIC_MODEL=claude-3-5-haiku-latest   # opzionale, è già il default nel codice

# Migrazione — SQL Editor di Supabase, incolla ed esegui (idempotente):
#   supabase/suit_telemetry_schema_v3_daily_brain.sql

# Redeploy della function con lo schema esteso
supabase functions deploy karen-oracle
```

---

## 3. Schema del payload `directives`

```json
{
  "mission_control": { "load_adjustment_pct": -10, "rationale": "..." },
  "focus_timer": { "focus_minutes": 25, "break_minutes": 5, "preset_label": "25/5 — Standard", "rationale": "..." },
  "study_window": { "start_hour": 15, "end_hour": 18, "label": "15:00–18:00", "rationale": "..." }
}
```

Ogni campo è validato e clampato server-side (`sanitizeDirectives` in `index.ts`) prima di essere persistito: un valore fuori range o mancante nella risposta di Claude fa ricadere SOLO quel blocco sul default deterministico della banda corrente — mai l'intero payload. Fallback per banda (usato sia quando il parsing dell'intera risposta fallisce, sia blocco-per-blocco):

| Banda | `load_adjustment_pct` | Focus/Pausa | `study_window` di default |
|---|---|---|---|
| CRITICO | -30 | 25/5 | 15:00–18:00 |
| ATTENZIONE | -10 | 25/5 | 15:00–18:00 |
| OTTIMALE | 0 | 50/10 | 15:00–18:00 |

---

## 4. Superfici pervasive lato client

- **Sidebar** — chip readiness sempre visibile, ogni pagina (stesso idioma visivo del chip Cloud Sync già esistente).
- **Mission Control** — box briefing sostituito dal vero `briefing_text`/`tactical_advice` di K.A.R.E.N. quando disponibile per oggi (fallback automatico alla citazione statica a rotazione se assente); banner soft quando `mission_control.load_adjustment_pct < 0`; chip "Picco cognitivo" da `study_window`; badge "Preset Adattivo K.A.R.E.N." accanto al Tactical Timer quando il Focus Timer Adattivo è attivo.
- **Focus Timer Adattivo** — `ArachnoForgeContext.jsx` calcola `effectiveFocusTime`/`effectiveShortBreakTime` da `directives.focus_timer` (se `settings.karenAdaptiveTimer !== false`) e li passa a `useFocusTimer`: il timer che parte davvero usa questi minuti, non solo l'anteprima UI. Mai la Pausa Lunga, volutamente esclusa dall'automazione.
- **Core Config** — toggle esplicito `settings.karenAdaptiveTimer` (default `true`) per disattivare l'override in qualsiasi momento.

---

## 5. Verifica

- Rieseguire `suit_telemetry_schema_v3_daily_brain.sql` due volte di fila — nessun errore "already exists" (idempotenza).
- `curl` su `karen-oracle` (stesso comando di `docs/PHASE1_BIOMETRIC_HUD.md` §4.1) con `force: true` — verificare che `briefing.directives` torni valorizzato con tutti e 3 i blocchi.
- Spegnere temporaneamente `ANTHROPIC_API_KEY` (o forzare un errore di rete) per verificare il ramo di fallback deterministico: `directives` deve comunque tornare completo, coerente con la banda calcolata.
- In app: attivare/disattivare `karenAdaptiveTimer` in Core Config e verificare che i minuti mostrati nel pulsante "Avvia Focus" (Mission Control) cambino di conseguenza.
