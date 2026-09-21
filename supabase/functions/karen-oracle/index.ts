// =====================================================================
// ArachnoForge — supabase/functions/karen-oracle/index.ts
// K.A.R.E.N. AI Engine — v4 "Blindatura & Governance" (Fase 5)
// =====================================================================
// Deploy:  supabase functions deploy karen-oracle
// Secrets:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5   (opzionale — default già Sonnet)
//
// NOVITÀ v2 (Fase 3):
//   1. Readiness Score ribilanciato 50/50 — Biometria oggettiva (sonno,
//      HR a riposo, attività) 50 punti, Log Soggettivo (focus, energia,
//      stress, indolenzimento) 50 punti — invece dell'80/20 della v1.
//   2. Il body della request DEVE contenere `date` (YYYY-MM-DD, locale
//      del chiamante) — nessun fallback silenzioso su "oggi UTC": era un
//      Timezone Trap reale. Vedi validateDateParam in ./_logic.ts.
//   3. Lifecycle & Cache: se esiste già un karen_briefings per
//      user_id+date e la request non passa `force: true`, la function
//      NON richiama Claude — restituisce il briefing già salvato
//      (`cached: true` nella risposta). Solo `force: true` (pulsante
//      "Rigenera Diagnostica" in SuitTelemetryView) forza una nuova
//      chiamata AI e sovrascrive la riga.
//
// NOVITÀ v3 (Fase 4 — "Daily Brain"): STESSA identica chiamata Claude
// giornaliera (zero chiamate AI aggiuntive, zero cambio di lifecycle) —
// il JSON richiesto a Claude cresce da {briefing_text, tactical_advice}
// a un payload `directives` esteso ({mission_control, focus_timer,
// study_window}), persistito nella colonna `directives` di
// karen_briefings (migration v3) e consumato pervasivamente lato client
// (KarenBrainContext.jsx).
//
// NOVITÀ v4 (Fase 5 — "Blindatura & Governance"):
//   1. Tutta la logica pura (readiness engine, sanitizzazione direttive,
//      prompt builder) è stata estratta in ./_logic.ts — questo file
//      resta l'unico che tocca rete/DB/env, importa tutto il resto.
//      Vedi _logic.ts e _logic.test.ts (Deno.test) nella stessa cartella.
//   2. Rate-limit sulle rigenerazioni manuali: `force: true` quando esiste
//      già un briefing per la data resta gratuito fino a
//      MAX_FORCE_REGENERATIONS_PER_DAY volte/giorno, poi la function
//      restituisce il briefing cache esistente con `rate_limited: true`
//      invece di richiamare Claude (protezione di budget — vedi
//      _logic.ts per il ragionamento completo). La prima generazione del
//      giorno non è mai conteggiata come rigenerazione.
//   3. `study_window` più intelligente: quando lo storico delle sessioni
//      Focus dell'utente (`user_data.app_state.starLog`, SOLA LETTURA) ha
//      almeno 5 campioni negli ultimi 60 giorni, la fascia oraria più
//      frequentata sostituisce il default pomeridiano generico — sia nel
//      prompt inviato a Claude sia nel fallback deterministico. Questa è
//      l'unica lettura che karen-oracle fa fuori dalle 3 tabelle
//      biometriche isolate: è a senso unico (mai una scrittura verso
//      user_data da questa function) e degrada con grazia a `null` se
//      lo storico manca o è insufficiente.
//
// NOVITÀ v5 (Study Focus Engine — "capire materia e argomento"):
//   1. `user_data.app_state.materie` (STESSA riga già letta per il punto
//      3 sopra, zero query aggiuntive) alimenta selectStudyFocusCandidates
//      (./_logic.ts): un piccolo paniere di argomenti/materie REALI del
//      Web-Matrix (nome, obiettivo, note, difficoltà) entra nel prompt,
//      cosi' Claude può leggere il CONTENUTO effettivo di ciò che il
//      Cadetto sta per studiare e scegliere l'argomento e la tecnica di
//      studio più adatta, non solo dare direttive generiche su readiness
//      biometrica. Nuovo campo `directives.study_focus` (stesso ciclo
//      cache/1-chiamata-al-giorno, zero costo AI aggiuntivo, mai un
//      payload mancante — vedi commenti in _logic.ts).
//   2. Modello tornato a Sonnet (era Haiku dalla V35.0): con un solo
//      utente e una chiamata/giorno il costo è comunque trascurabile — si
//      privilegia la qualità del piano pedagogico.
//
// Chiamata (dal frontend, useSuitTelemetry.triggerOracleScan):
//   supabase.functions.invoke('karen-oracle', { body: { date: todayStr, force: false } });
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  validateDateParam,
  computeReadinessScore,
  readinessBand,
  buildSystemPrompt,
  defaultDirectivesForBand,
  sanitizeDirectives,
  buildUserPrompt,
  computeHistoricalStudyWindow,
  computeYesterdayOutcome,
  computePersonalSleepTarget,
  findQuizNodeContext,
  buildQuizSystemPrompt,
  buildQuizUserPrompt,
  sanitizeQuiz,
  selectStudyFocusCandidates,
  HR_BASELINE_WINDOW_DAYS,
  HR_BASELINE_MIN_SAMPLES,
  MAX_FORCE_REGENERATIONS_PER_DAY,
  MAX_QUIZ_GENERATIONS_PER_DAY,
  type Directives
} from './_logic.ts';

// ---------------------------------------------------------------------
// Config / secrets
// ---------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
// V35.3 — App a singolo utente: 1 sola chiamata/utente/giorno rende il
// costo trascurabile con QUALUNQUE modello — tornato a Sonnet (il default
// originale pre-V35.0) per privilegiare la qualità del piano pedagogico
// (Study Focus Engine) invece del risparmio, che qui non ha impatto reale
// sul budget. Override via env-var resta comunque possibile.
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// V37.0 — CORS ristretto. `*` non era sfruttabile (ogni chiamata richiede
// comunque un JWT valido), ma un allow-list costa nulla e toglie di mezzo
// un'intera classe di sorprese. `ALLOWED_ORIGINS` è una lista separata da
// virgole impostabile con `supabase secrets set ALLOWED_ORIGINS=...`;
// se non è impostata si torna al comportamento permissivo di prima,
// così un deploy esistente non smette di funzionare.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin =
    ALLOWED_ORIGINS.length === 0 ? '*' : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin'
  };
}

function jsonResponse(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(req ? corsHeaders(req) : { 'Access-Control-Allow-Origin': '*' }), 'Content-Type': 'application/json' }
  });
}

/**
 * V37.0 — Timeout esplicito sulle chiamate ad Anthropic. Senza, una
 * risposta lenta o una connessione appesa tiene occupata la function
 * fino al timeout di piattaforma, e il client resta bloccato sullo
 * spinner senza sapere perché. Meglio un errore onesto e rapido.
 */
const ANTHROPIC_TIMEOUT_MS = 45_000;

async function fetchAnthropic(body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    return await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo non consentito. Usa POST.' }, 405, req);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
    console.error('karen-oracle: variabili d\'ambiente mancanti', {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasAnonKey: !!SUPABASE_ANON_KEY,
      hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
      hasAnthropicKey: !!ANTHROPIC_API_KEY
    });
    return jsonResponse(
      { error: 'Configurazione server incompleta: un secret richiesto non è impostato (vedi supabase secrets set).' },
      500,
      req
    );
  }

  try {
    // -- 1. Identifica il chiamante dal suo JWT (mai un user_id dal body) --
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Authorization header mancante.' }, 401, req);
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const {
      data: { user },
      error: userError
    } = await callerClient.auth.getUser();

    if (userError || !user) {
      // Distinzione esplicita: un JWT scaduto/non valido è un problema di
      // sessione (401, il client può tentare un refresh e ritentare), mai
      // un generico 500 che nasconderebbe la causa reale.
      return jsonResponse({ error: 'Sessione non valida o scaduta.', code: 'INVALID_SESSION' }, 401, req);
    }

    // -- 2. Body: `date` obbligatorio (Timezone Trap — vedi validateDateParam) --
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: "Body JSON mancante o non valido." }, 400, req);
    }

    // -- 2b. V36.0 — MODALITÀ QUIZ ("Interrogazione K.A.R.E.N.").
    //        Ramo completamente separato dal lifecycle del briefing
    //        giornaliero: on-demand, non tocca `karen_briefings` né alcuna
    //        altra tabella, non consuma il tetto di rigenerazioni e non
    //        interferisce con la cache del giorno. Le domande tornano al
    //        client, che le salva DENTRO il nodo nel Cloud State esistente
    //        (`sfida.quiz`) — zero migrazioni di schema. Il contenuto del
    //        nodo viene letto SEMPRE dal database, mai dal body. --
    if ((body as Record<string, unknown>).mode === 'quiz') {
      const materiaId = String((body as Record<string, unknown>).materiaId ?? '');
      const sfidaId = String((body as Record<string, unknown>).sfidaId ?? '');
      if (!materiaId || !sfidaId) {
        return jsonResponse({ error: "Modalità quiz: 'materiaId' e 'sfidaId' sono obbligatori." }, 400, req);
      }

      const adminForQuiz = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: quizUserData } = await adminForQuiz
        .from('user_data')
        .select('app_state')
        .eq('user_id', user.id)
        .maybeSingle();

      const quizAppState = quizUserData?.app_state as Record<string, unknown> | null | undefined;
      const nodeCtx = findQuizNodeContext(quizAppState?.materie, materiaId, sfidaId);
      if (!nodeCtx) {
        return jsonResponse({ error: 'Nodo non trovato nel Web-Matrix: potrebbe essere stato rinominato o eliminato.' }, 404, req);
      }

      // V37.0 — Tetto giornaliero sulle Interrogazioni. Era l'unico ramo
      // AI senza alcun limite: il pulsante "Rigenera" è a portata di mano
      // su ogni nodo completato e ogni pressione è una chiamata Sonnet.
      // L'incremento è ATOMICO lato database (vedi
      // supabase/karen_ai_usage_v7_quiz_rate_limit.sql): un SELECT
      // seguito da UPDATE qui lascerebbe scavalcare il tetto proprio
      // sotto doppio-click. Il conteggio avviene PRIMA della chiamata —
      // meglio sprecare un'unità su un errore di rete che permettere
      // chiamate non contate.
      const usageDate =
        validateDateParam((body as Record<string, unknown>).date) ?? new Date().toISOString().slice(0, 10);
      let quizCallsToday = 0;
      const { data: bumped, error: usageError } = await adminForQuiz.rpc('bump_karen_quiz_usage', {
        p_user_id: user.id,
        p_date: usageDate
      });
      if (usageError) {
        // Migrazione non ancora eseguita (42P01 / funzione assente): si
        // procede senza tetto, esattamente come prima. Mai un'app che
        // smette di funzionare per una migrazione mancante.
        console.warn('karen-oracle (quiz): contatore di utilizzo non disponibile', usageError.message);
      } else {
        quizCallsToday = Number(bumped) || 0;
        if (quizCallsToday > MAX_QUIZ_GENERATIONS_PER_DAY) {
          return jsonResponse(
            {
              error:
                `Limite di ${MAX_QUIZ_GENERATIONS_PER_DAY} interrogazioni al giorno raggiunto. ` +
                'Le domande già generate restano salvate sui nodi e disponibili offline: riprova domani.',
              rate_limited: true,
              quiz_calls_today: quizCallsToday - 1,
              quiz_calls_limit: MAX_QUIZ_GENERATIONS_PER_DAY
            },
            429,
            req
          );
        }
      }

      const quizRes = await fetchAnthropic({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        system: buildQuizSystemPrompt(),
        messages: [{ role: 'user', content: buildQuizUserPrompt(nodeCtx) }]
      });

      if (!quizRes.ok) {
        const errText = await quizRes.text();
        console.error('karen-oracle (quiz): Anthropic API error', quizRes.status, errText);
        return jsonResponse({ error: "K.A.R.E.N. non è riuscita a contattare il nucleo tattico (Claude API)." }, 502, req);
      }

      const quizJson = await quizRes.json();
      const quizText: string = (Array.isArray(quizJson?.content) ? quizJson.content : [])
        .filter((block: { type?: string; text?: string }) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: { text?: string }) => block.text)
        .join('\n')
        .trim();

      let quiz = null;
      try {
        const cleaned = quizText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
        quiz = sanitizeQuiz(JSON.parse(cleaned));
      } catch (quizParseErr) {
        console.error('karen-oracle (quiz): parsing fallito', quizParseErr, quizText);
      }

      if (!quiz) {
        // Nessun fallback deterministico possibile: non si inventano
        // domande su un contenuto che il server non conosce. Meglio un
        // errore onesto che otto domande generiche spacciate per mirate.
        return jsonResponse({ error: "K.A.R.E.N. non è riuscita a produrre un'interrogazione valida su questo nodo. Riprova." }, 502, req);
      }

      return jsonResponse(
        {
          quiz: { ...quiz, generatedAt: new Date().toISOString(), argomento: nodeCtx.argomento },
          thin_context: (nodeCtx.obiettivo.length + nodeCtx.blueprint.length + nodeCtx.note.length) < 40,
          quiz_calls_today: quizCallsToday,
          quiz_calls_limit: MAX_QUIZ_GENERATIONS_PER_DAY
        },
        200,
        req
      );
    }

    const targetDate = validateDateParam((body as Record<string, unknown>).date);
    if (!targetDate) {
      return jsonResponse(
        { error: "Campo 'date' obbligatorio, formato YYYY-MM-DD (data LOCALE del chiamante, mai calcolata lato server)." },
        400,
        req
      );
    }
    const force = (body as Record<string, unknown>).force === true;

    // -- 3. Client con Service Role — bypassa la RLS per leggere/scrivere
    //       in modo affidabile lato server (karen_briefings è SELECT-only
    //       per "authenticated", vedi supabase/suit_telemetry_schema.sql) --
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // -- 4. Lifecycle & Cache: si recupera SEMPRE l'eventuale briefing già
    //       esistente per oggi (anche con force:true — serve comunque per
    //       il conteggio delle rigenerazioni e come fallback se il tetto
    //       è superato). Senza force, si restituisce direttamente. --
    const { data: existing, error: existingError } = await admin
      .from('karen_briefings')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', targetDate)
      .maybeSingle();

    if (existingError) {
      console.error('karen-oracle: errore nel controllo cache', existingError);
    }

    if (existing && !force) {
      return jsonResponse({ briefing: existing, readiness_band: readinessBand(existing.readiness_score), cached: true }, 200, req);
    }

    // -- 4b. Governance costi: `force: true` su un briefing già esistente
    //       è una RIGENERAZIONE e viene conteggiata. Oltre il tetto
    //       giornaliero, si restituisce la cache esistente con un flag
    //       esplicito invece di richiamare Claude — mai un blocco silenzioso
    //       che sembri un errore, mai un costo illimitato. La primissima
    //       generazione del giorno (existing == null) non passa mai di qui. --
    if (existing && force) {
      const currentRegenCount = existing.regen_count ?? 0;
      if (currentRegenCount >= MAX_FORCE_REGENERATIONS_PER_DAY) {
        return jsonResponse({
          briefing: existing,
          readiness_band: readinessBand(existing.readiness_score),
          cached: true,
          rate_limited: true,
          error: `Limite di ${MAX_FORCE_REGENERATIONS_PER_DAY} rigenerazioni manuali/giorno raggiunto. Riprova domani, oppure attendi la prossima generazione automatica.`
        }, 200, req);
      }
    }

    // -- 5. Raccolta dati: biometria di oggi, log soggettivo di oggi,
    //       baseline HR a riposo (ultimi 14 giorni), briefing di ieri, e
    //       (V35.1) il Cloud State principale — SOLA LETTURA, usato
    //       unicamente per dedurre lo storico della finestra Focus più
    //       frequentata (vedi computeHistoricalStudyWindow in _logic.ts).
    //       Deliberatamente MAI dal body della request: la fonte di
    //       verità per il calcolo resta sempre il database, mai un
    //       payload che il client potrebbe alterare. --
    const baselineSince = new Date(new Date(`${targetDate}T00:00:00Z`).getTime() - HR_BASELINE_WINDOW_DAYS * 86400000)
      .toISOString()
      .slice(0, 10);

    const [{ data: bioToday }, { data: subjectiveToday }, { data: hrHistory }, { data: yesterdayBriefing }, { data: userData }] =
      await Promise.all([
        admin
          .from('suit_biometrics')
          .select('sleep_total_min, sleep_deep_min, sleep_rem_min, resting_hr, steps, active_calories')
          .eq('user_id', user.id)
          .eq('date', targetDate)
          .maybeSingle(),
        admin
          .from('cadet_subjective_logs')
          .select('focus_level, energy_level, stress_level, muscle_soreness, mood, caffeine_mg')
          .eq('user_id', user.id)
          .eq('date', targetDate)
          .maybeSingle(),
        admin
          .from('suit_biometrics')
          // V36.0 — stessa query, una colonna in più: `sleep_total_min`
          // alimenta il target di sonno PERSONALE (vedi
          // computePersonalSleepTarget). Zero round-trip aggiuntivi.
          .select('resting_hr, sleep_total_min, date')
          .eq('user_id', user.id)
          .gte('date', baselineSince)
          .lt('date', targetDate)
          .not('resting_hr', 'is', null),
        admin
          .from('karen_briefings')
          // V36.0 — anche `directives`: servono per confrontare ciò che
          // K.A.R.E.N. aveva consigliato ieri con ciò che è successo
          // davvero (computeYesterdayOutcome).
          .select('briefing_text, directives')
          .eq('user_id', user.id)
          .lt('date', targetDate)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from('user_data')
          .select('app_state')
          .eq('user_id', user.id)
          .maybeSingle()
      ]);

    const hrSamples = (hrHistory ?? []).map((r: { resting_hr: number }) => r.resting_hr).filter((v) => v != null);
    const baselineHr =
      hrSamples.length >= HR_BASELINE_MIN_SAMPLES
        ? Math.round(hrSamples.reduce((a: number, b: number) => a + b, 0) / hrSamples.length)
        : null;

    // V36.0 — Target di sonno personale, dedotto dalla stessa finestra di
    // osservazione già usata per la baseline cardiaca. Sotto la soglia di
    // campioni resta il 7h30 universale, dichiarato come tale.
    const sleepSamples = (hrHistory ?? []).map((r: { sleep_total_min: number | null }) => r.sleep_total_min);
    const sleepTarget = computePersonalSleepTarget(sleepSamples);

    const readiness = computeReadinessScore(bioToday ?? null, baselineHr, subjectiveToday ?? null, sleepTarget.target);
    const band = readinessBand(readiness.score);

    // Lettura SOLA-LETTURA, a senso unico, di app_state.starLog — degrada
    // a `null` con grazia se assente/vuoto/insufficiente (vedi commento
    // esteso su computeHistoricalStudyWindow in _logic.ts).
    const appState = userData?.app_state as Record<string, unknown> | null | undefined;
    const historicalWindow = computeHistoricalStudyWindow(appState?.starLog, targetDate);
    // V35.3 — Study Focus Engine: STESSA riga app_state qui sopra, nessuna
    // query aggiuntiva. Degrada con grazia a liste vuote se `materie`
    // manca/è vuoto (vedi selectStudyFocusCandidates in _logic.ts).
    const studyFocus = selectStudyFocusCandidates(appState?.materie, targetDate);
    // V36.0 — Chiusura del ciclo: cosa è realmente successo ieri, contro
    // le direttive che K.A.R.E.N. aveva emesso ieri. Stessa riga app_state,
    // nessuna query aggiuntiva.
    const yesterdayOutcome = computeYesterdayOutcome(appState?.starLog, targetDate, yesterdayBriefing?.directives ?? null);

    // -- 6. Chiamata a Claude (via Supabase Edge Function — MAI dal client) --
    const anthropicRes = await fetchAnthropic({
      model: ANTHROPIC_MODEL,
      // V35.3 — 700 -> 1000: lo schema ha un nuovo blocco study_focus
      // (argomento_principale + fino a MAX_DUE_REVIEWS ripassi, ognuno
      // con una motivazione testuale) — margine per non troncare la
      // risposta JSON di Claude a metà.
      // V36.0 — 1000 -> 1400: una risposta troncata NON produce un
      // errore visibile, cade silenziosamente sul fallback deterministico
      // e il piano della giornata perde tutta la parte pedagogica senza
      // che nulla lo segnali. Con una chiamata al giorno il margine in
      // più non ha alcun impatto reale sul costo.
      max_tokens: 1400,
      system: buildSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildUserPrompt({
            date: targetDate,
            readiness,
            band,
            bio: bioToday ?? null,
            subjective: subjectiveToday ?? null,
            previousBriefing: yesterdayBriefing?.briefing_text ?? null,
            historicalWindow,
            studyFocus,
            yesterdayOutcome
          })
        }
      ]
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errText);
      return jsonResponse({ error: 'K.A.R.E.N. non è riuscita a contattare il nucleo tattico (Claude API).' }, 502, req);
    }

    const anthropicJson = await anthropicRes.json();
    // Non indicizzare content[0] alla cieca: la risposta può contenere
    // blocchi 'thinking'/'redacted_thinking' prima del testo, o più
    // blocchi 'text' — si filtra per type e si concatenano tutti i
    // blocchi di testo trovati, cosi' la function non si blocca né
    // produce un rawText vuoto solo per l'ordine dei blocchi.
    const contentBlocks = Array.isArray(anthropicJson?.content) ? anthropicJson.content : [];
    const rawText: string = contentBlocks
      .filter((block: { type?: string; text?: string }) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: { text?: string }) => block.text)
      .join('\n')
      .trim();

    let briefingText: string;
    let tacticalAdvice: string;
    // V35.0 — Daily Brain: `directives` viene SEMPRE valorizzato, sia sul
    // ramo di successo (sanitizeDirectives valida/clampa il JSON di
    // Claude, ricadendo blocco-per-blocco sul default della banda per
    // qualunque campo anomalo) sia sul ramo di fallback totale (parsing
    // fallito -> default deterministico completo) — mai un payload
    // parziale o mancante che lascerebbe l'HUD senza direttive per oggi.
    let directives: Directives;
    try {
      const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(cleaned);
      briefingText = String(parsed.briefing_text ?? '').trim();
      tacticalAdvice = String(parsed.tactical_advice ?? '').trim();
      if (!briefingText || !tacticalAdvice) throw new Error('Campi mancanti nel JSON di Claude.');
      directives = sanitizeDirectives(parsed, band, historicalWindow, studyFocus);
    } catch (parseErr) {
      console.error('Parsing risposta Claude fallito:', parseErr, rawText);
      // Fallback deterministico — l'app non deve mai restare senza
      // briefing solo perché il modello ha risposto in un formato inatteso.
      briefingText = `Telemetria acquisita. Readiness Score odierno: ${readiness.score}/100 (${band}). Dati disponibili: oggettivi ${Math.round(
        (readiness.breakdown.objectiveCompleteness ?? 0) * 100
      )}%, soggettivi ${Math.round((readiness.breakdown.subjectiveCompleteness ?? 0) * 100)}%.`;
      tacticalAdvice =
        band === 'CRITICO'
          ? 'Riduci il carico di Focus odierno e privilegia recupero attivo: la Quota Odierna può attendere qualche ora in più.'
          : 'Procedi con la Quota Odierna pianificata, monitorando eventuali segnali di affaticamento.';
      directives = defaultDirectivesForBand(band, historicalWindow, studyFocus);
    }

    // -- 7. Persistenza (upsert — un solo briefing per utente/giorno).
    //       `regen_count` si incrementa SOLO quando questa chiamata è una
    //       rigenerazione manuale di un briefing già esistente (governance
    //       costi, vedi punto 4b) — la primissima generazione del giorno
    //       parte sempre da 0. --
    const nextRegenCount = existing ? (existing.regen_count ?? 0) + 1 : 0;
    const { data: saved, error: saveError } = await admin
      .from('karen_briefings')
      .upsert(
        {
          user_id: user.id,
          date: targetDate,
          readiness_score: readiness.score,
          briefing_text: briefingText,
          tactical_advice: tacticalAdvice,
          score_breakdown: readiness.breakdown,
          directives,
          regen_count: nextRegenCount
        },
        { onConflict: 'user_id,date' }
      )
      .select()
      .single();

    if (saveError) {
      console.error('Errore salvataggio karen_briefings:', saveError);
      return jsonResponse({ error: 'Briefing generato ma non salvato.', details: saveError.message }, 500, req);
    }

    return jsonResponse({ briefing: saved, readiness_band: band, cached: false }, 200, req);
  } catch (err) {
    console.error('karen-oracle: errore inatteso', err);
    return jsonResponse({ error: 'Errore interno di K.A.R.E.N.' }, 500, req);
  }
});
