// =====================================================================
// ArachnoForge — supabase/functions/karen-oracle/index.ts
// K.A.R.E.N. AI Engine — v6 "Un piano, non un oroscopo" (V42)
// =====================================================================
// Deploy:  supabase functions deploy karen-oracle
// Secrets:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set KAREN_ALLOWED_EMAILS=tua@email.it     (consigliato)
//   supabase secrets set KAREN_ALLOWED_USER_IDS=<uuid>          (in alternativa)
//   supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5        (opzionale: è già il default)
//   supabase secrets set ALLOWED_ORIGINS=https://tuo-dominio    (opzionale)
// Database: eseguire supabase/karen_v8_governance.sql (contatori unici e
// cache del bilancio settimanale). Senza, la function funziona lo stesso:
// ricade sui contatori della v7 e non salva i bilanci.
//
// Questo file tocca rete, database e segreti; tutta la logica pura
// (readiness, piano, prompt, validazione delle risposte) vive in
// ./_logic.ts ed è coperta da _logic.test.ts.
//
// MODALITÀ (campo `mode` del body):
//   (assente)   Daily Briefing: readiness + piano di oggi → direttive.
//   'quiz'      domande di richiamo attivo su UN nodo.
//   'oral'      interrogazione orale simulata su 1-5 argomenti di una materia.
//   'oral_eval' valutazione di una risposta scritta a una domanda dell'orale.
//   'weekly'    bilancio della settimana, salvato per settimana.
//
// STORIA IN BREVE
//   v2  data locale obbligatoria (Timezone Trap), cache per utente/giorno.
//   v3  direttive "Daily Brain" nella stessa chiamata.
//   v4  logica estratta in _logic.ts, tetto alle rigenerazioni.
//   v5  Study Focus Engine: argomenti reali del Web-Matrix nel prompt.
//   v6 (V42):
//    1. Accesso ristretto (KAREN_ALLOWED_*): una sessione valida non basta,
//       deve essere la tua. Registrazioni aperte ≠ IA gratis per tutti.
//    2. La data del client vale solo entro ±1 giorno da quella del server;
//       i contatori usano il giorno UTC del SERVER (cambiare data non li
//       azzera) e sono atomici per ogni modalità.
//    3. Il piano di oggi calcolato dall'app (`plan_context`) entra nel
//       prompt, validato contro lo stato salvato (id veri, nomi dal
//       database, numeri troncati): K.A.R.E.N. sceglie DENTRO il piano.
//    4. Readiness "non nota" con pochi dati: direttive neutre, niente
//       riduzioni di carico né timer inventati.
//    5. Modello di riserva se quello configurato non esiste o è
//       sovraccarico; JSON estratto in modo robusto; una risposta troncata
//       si riprova una volta con più spazio.
//    6. Se Claude non risponde, un briefing buono già salvato NON viene mai
//       sovrascritto da un ripiego; il ripiego del primo giro è dichiarato
//       (`directives.source = 'fallback'`) e si riprova alla richiesta dopo.
//    7. Nei log niente testo generato né dati di salute: solo esiti e
//       lunghezze.
// =====================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  validateDateParam,
  isDateWithinServerWindow,
  serverDateKey,
  parseAllowList,
  isUserAllowed,
  DEFAULT_MODEL,
  fallbackModelFor,
  extractJsonObject,
  responseText,
  wasTruncated,
  cleanUserText,
  computeReadinessScore,
  readinessBand,
  readinessIsKnown,
  buildSystemPrompt,
  defaultDirectivesForBand,
  sanitizeDirectives,
  buildUserPrompt,
  computeHistoricalStudyWindow,
  computeYesterdayOutcome,
  computePersonalSleepTarget,
  normalizeMaterie,
  sanitizePlanContext,
  selectStudyFocusCandidates,
  shouldRetryFallbackBriefing,
  isFallbackBriefing,
  dateKeyDaysBefore,
  findQuizNodeContext,
  quizContextIsThin,
  buildQuizSystemPrompt,
  buildQuizUserPrompt,
  sanitizeQuiz,
  findOralContext,
  oralContextIsThin,
  buildOralSystemPrompt,
  buildOralUserPrompt,
  sanitizeOral,
  parseOralEvalInput,
  buildOralEvalSystemPrompt,
  buildOralEvalUserPrompt,
  sanitizeOralEval,
  validateWeekParam,
  weekIsClosed,
  sanitizeWeeklyContext,
  buildWeeklySystemPrompt,
  buildWeeklyUserPrompt,
  sanitizeWeeklyReview,
  HR_BASELINE_WINDOW_DAYS,
  HR_BASELINE_MIN_SAMPLES,
  USAGE_LIMITS,
  type UsageKind,
  type Directives
} from './_logic.ts';

// ---------------------------------------------------------------------
// Config / secrets
// ---------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const ANTHROPIC_MODEL = (Deno.env.get('ANTHROPIC_MODEL') ?? '').trim() || DEFAULT_MODEL;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// V42 — chi può usare K.A.R.E.N. (vedi isUserAllowed in _logic.ts).
const ALLOWED_USER_IDS = parseAllowList(Deno.env.get('KAREN_ALLOWED_USER_IDS'));
const ALLOWED_EMAILS = parseAllowList(Deno.env.get('KAREN_ALLOWED_EMAILS'));
const ALLOW_ALL = (Deno.env.get('KAREN_ALLOW_ALL') ?? '').trim().toLowerCase() === 'true';
const ALLOWLIST_SET = ALLOWED_USER_IDS.length > 0 || ALLOWED_EMAILS.length > 0;
if (!ALLOWLIST_SET) {
  console.warn(
    ALLOW_ALL
      ? 'karen-oracle: KAREN_ALLOW_ALL=true — ogni utente autenticato può usare l’IA.'
      : 'karen-oracle: nessuna allowlist impostata (KAREN_ALLOWED_EMAILS / KAREN_ALLOWED_USER_IDS): nessun account è abilitato finché non la imposti.'
  );
}

// CORS ristretto: `ALLOWED_ORIGINS` (lista separata da virgole). Non
// impostata = permissivo come prima (ogni chiamata richiede comunque un JWT).
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.length === 0 ? '*' : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin'
  };
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
  });
}

// ---------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------
/** Timeout esplicito: meglio un errore onesto e rapido di uno spinner infinito. */
const ANTHROPIC_TIMEOUT_MS = 45_000;

type ClaudeCall =
  | { ok: true; model: string; text: string; truncated: boolean }
  | { ok: false; model: string; status: number; errorType: string | null };

async function postAnthropic(model: string, system: string, user: string, maxTokens: number): Promise<Response> {
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
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Una chiamata con ripiego di modello: se il modello configurato non
 * esiste (404) o è sovraccarico (529), si prova UNA volta il successivo
 * della catena (fallbackModelFor). Nei log solo stato e tipo d'errore.
 */
async function callClaude(system: string, user: string, maxTokens: number): Promise<ClaudeCall> {
  let model = ANTHROPIC_MODEL;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await postAnthropic(model, system, user, maxTokens);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      console.error('karen-oracle: Claude non raggiungibile', { model, aborted });
      return { ok: false, model, status: aborted ? 504 : 502, errorType: aborted ? 'timeout' : 'network' };
    }
    if (res.ok) {
      const json = await res.json().catch(() => null);
      return { ok: true, model, text: responseText(json), truncated: wasTruncated(json) };
    }
    const errBody = await res.json().catch(() => null);
    const errorType = typeof errBody?.error?.type === 'string' ? errBody.error.type : null;
    console.error('karen-oracle: errore Claude API', { model, status: res.status, errorType });
    const next = res.status === 404 || res.status === 529 ? fallbackModelFor(model) : null;
    if (!next) return { ok: false, model, status: res.status, errorType };
    model = next;
  }
  return { ok: false, model, status: 502, errorType: 'fallback_exhausted' };
}

type ClaudeJson =
  | { ok: true; model: string; parsed: unknown }
  | { ok: false; model: string; status: number; reason: string };

/** Chiamata + estrazione del JSON; una risposta troncata si riprova una volta con più spazio. */
async function callClaudeJson(system: string, user: string, maxTokens: number, retryMaxTokens: number | null = null): Promise<ClaudeJson> {
  let call = await callClaude(system, user, maxTokens);
  if (!call.ok) return { ok: false, model: call.model, status: call.status, reason: call.errorType ?? 'api_error' };
  let parsed = extractJsonObject(call.text);
  if (parsed == null && call.truncated && retryMaxTokens) {
    console.warn('karen-oracle: risposta troncata, nuovo tentativo con più token', { model: call.model, length: call.text.length });
    call = await callClaude(system, user, retryMaxTokens);
    if (!call.ok) return { ok: false, model: call.model, status: call.status, reason: call.errorType ?? 'api_error' };
    parsed = extractJsonObject(call.text);
  }
  if (parsed == null) {
    console.error('karen-oracle: JSON non leggibile nella risposta', { model: call.model, length: call.text.length, truncated: call.truncated });
    return { ok: false, model: call.model, status: 502, reason: call.truncated ? 'truncated' : 'unparsable' };
  }
  return { ok: true, model: call.model, parsed };
}

// ---------------------------------------------------------------------
// Contatori di utilizzo (atomici, sul giorno UTC del server)
// ---------------------------------------------------------------------
type Usage = { count: number | null };

/**
 * +1 atomico sul contatore della modalità. Con la migrazione v8 assente
 * si ricade sul contatore quiz della v7 (solo per i quiz) oppure si
 * procede senza tetto: una migrazione mancante non spegne l'app.
 */
async function bumpUsage(admin: SupabaseClient, userId: string, kind: UsageKind): Promise<Usage> {
  const day = serverDateKey();
  const { data, error } = await admin.rpc('bump_karen_usage', { p_user_id: userId, p_date: day, p_kind: kind });
  if (!error) return { count: Number(data) || 0 };
  if (kind === 'quiz') {
    const legacy = await admin.rpc('bump_karen_quiz_usage', { p_user_id: userId, p_date: day });
    if (!legacy.error) return { count: Number(legacy.data) || 0 };
  }
  console.warn('karen-oracle: contatore di utilizzo non disponibile (eseguire karen_v8_governance.sql)', { kind, code: error.code ?? null });
  return { count: null };
}

const LIMIT_MESSAGES: Record<UsageKind, string> = {
  briefing: 'briefing nuovi al giorno raggiunto: riprova domani.',
  quiz: 'interrogazioni al giorno raggiunto. Le domande già generate restano salvate sui nodi.',
  regen: 'rigenerazioni del briefing al giorno raggiunto: il piano di oggi resta quello già generato.',
  retry: 'nuovi tentativi automatici al giorno raggiunto: il piano di ripiego resta valido per oggi.',
  oral: 'interrogazioni orali al giorno raggiunto: riprova domani.',
  oral_eval: 'valutazioni delle risposte al giorno raggiunto: per oggi giudicati sui punti chiave.',
  weekly: 'bilanci settimanali al giorno raggiunto: riprova domani.'
};

function overLimit(usage: Usage, kind: UsageKind): boolean {
  return usage.count != null && usage.count > USAGE_LIMITS[kind];
}

function limitResponse(req: Request, kind: UsageKind) {
  return jsonResponse(req, { error: `Limite di ${USAGE_LIMITS[kind]} ${LIMIT_MESSAGES[kind]}`, rate_limited: true, limit: USAGE_LIMITS[kind] }, 429);
}

// ---------------------------------------------------------------------
// Modalità
// ---------------------------------------------------------------------
type Ctx = {
  req: Request;
  body: Record<string, unknown>;
  userId: string;
  admin: SupabaseClient;
  appState: Record<string, unknown> | null;
};

const NODE_GONE = 'Nodo non trovato nel Web-Matrix: potrebbe essere stato rinominato o eliminato. Sincronizza e riprova.';

/** 'quiz' — domande di richiamo attivo su UN nodo, letto dal database. */
async function handleQuiz({ req, body, userId, admin, appState }: Ctx) {
  const materiaId = typeof body.materiaId === 'string' ? body.materiaId : '';
  const sfidaId = typeof body.sfidaId === 'string' ? body.sfidaId : '';
  if (!materiaId || !sfidaId) return jsonResponse(req, { error: "Modalità quiz: 'materiaId' e 'sfidaId' sono obbligatori." }, 400);
  const nodeCtx = findQuizNodeContext(appState?.materie, materiaId, sfidaId);
  if (!nodeCtx) return jsonResponse(req, { error: NODE_GONE }, 404);

  // Il conteggio avviene PRIMA della chiamata: meglio un'unità persa su un
  // errore di rete che chiamate non contate.
  const usage = await bumpUsage(admin, userId, 'quiz');
  if (overLimit(usage, 'quiz')) return limitResponse(req, 'quiz');

  // V44 — con appunti strutturati più ricchi le domande si allungano: un
  // secondo tentativo con più spazio, come per orale e bilancio (prima una
  // risposta tagliata finiva in errore e consumava la quota del giorno).
  const result = await callClaudeJson(buildQuizSystemPrompt(), buildQuizUserPrompt(nodeCtx), 1200, 2000);
  const quiz = result.ok ? sanitizeQuiz(result.parsed) : null;
  if (!quiz) {
    // Nessun ripiego inventato: niente domande generiche spacciate per mirate.
    return jsonResponse(req, { error: "K.A.R.E.N. non è riuscita a produrre un'interrogazione valida su questo nodo. Riprova." }, 502);
  }
  return jsonResponse(req, {
    quiz: { ...quiz, generatedAt: new Date().toISOString(), argomento: nodeCtx.argomento },
    thin_context: quizContextIsThin(nodeCtx),
    quiz_calls_today: usage.count,
    quiz_calls_limit: USAGE_LIMITS.quiz
  });
}

/** 'oral' — interrogazione orale su 1-5 argomenti di una materia. */
async function handleOral({ req, body, userId, admin, appState }: Ctx) {
  const materiaId = typeof body.materiaId === 'string' ? body.materiaId : '';
  if (!materiaId) return jsonResponse(req, { error: "Modalità orale: 'materiaId' è obbligatorio." }, 400);
  const ctx = findOralContext(appState?.materie, materiaId, body.sfidaIds);
  if (!ctx) return jsonResponse(req, { error: 'Argomenti non trovati nel Web-Matrix: sincronizza e riprova.' }, 404);

  const usage = await bumpUsage(admin, userId, 'oral');
  if (overLimit(usage, 'oral')) return limitResponse(req, 'oral');

  const result = await callClaudeJson(buildOralSystemPrompt(), buildOralUserPrompt(ctx), 2200, 3200);
  const oral = result.ok ? sanitizeOral(result.parsed, ctx) : null;
  if (!oral) return jsonResponse(req, { error: "K.A.R.E.N. non è riuscita a preparare l'interrogazione orale. Riprova." }, 502);
  return jsonResponse(req, { oral: { ...oral, materia: ctx.materia, generatedAt: new Date().toISOString() }, thin_context: oralContextIsThin(ctx) });
}

/** 'oral_eval' — valutazione di una risposta, sui punti chiave e sugli appunti del nodo. */
async function handleOralEval({ req, body, userId, admin, appState }: Ctx) {
  const materiaId = typeof body.materiaId === 'string' ? body.materiaId : '';
  const input = parseOralEvalInput(body);
  if (!materiaId || !input) return jsonResponse(req, { error: 'Serve una domanda e una risposta di almeno qualche parola.' }, 400);
  const materie = Array.isArray(appState?.materie) ? (appState!.materie as Record<string, unknown>[]) : [];
  const materia = materie.find((m) => m && typeof m === 'object' && m.id === materiaId);
  if (!materia) return jsonResponse(req, { error: 'Materia non trovata: sincronizza e riprova.' }, 404);
  const sfidaId = typeof body.sfidaId === 'string' ? body.sfidaId : '';
  const nodo = sfidaId ? findQuizNodeContext(appState?.materie, materiaId, sfidaId) : null;

  const usage = await bumpUsage(admin, userId, 'oral_eval');
  if (overLimit(usage, 'oral_eval')) return limitResponse(req, 'oral_eval');

  const result = await callClaudeJson(
    buildOralEvalSystemPrompt(),
    buildOralEvalUserPrompt(input, cleanUserText(materia.nome, 120) || 'Materia senza nome', nodo),
    700,
    1100
  );
  const valutazione = result.ok ? sanitizeOralEval(result.parsed) : null;
  if (!valutazione) return jsonResponse(req, { error: 'Valutazione non disponibile: giudicati sui punti chiave.' }, 502);
  return jsonResponse(req, { valutazione });
}

/** 'weekly' — bilancio della settimana, con cache per settimana (karen_weekly). */
async function handleWeekly({ req, body, userId, admin, appState }: Ctx) {
  const week = validateWeekParam(body.week);
  if (!week) return jsonResponse(req, { error: "Settimana non valida: serve il lunedì ('YYYY-MM-DD') di una delle ultime sei settimane." }, 400);
  const force = body.force === true;
  const todayKey = validateDateParam(body.date) && isDateWithinServerWindow(body.date as string) ? (body.date as string) : serverDateKey();

  // Cache: un bilancio fatto a settimana CHIUSA è definitivo; uno fatto a
  // metà settimana vale per la sua giornata, e a settimana finita si rifà.
  const settimanaChiusa = weekIsClosed(week, todayKey);
  const { data: cached, error: cacheError } = await admin
    .from('karen_weekly')
    .select('payload, updated_at, week_closed')
    .eq('user_id', userId)
    .eq('week_start', week)
    .maybeSingle();
  const cacheAvailable = !cacheError;
  if (cacheError && cacheError.code !== 'PGRST116') {
    console.warn('karen-oracle (weekly): cache non disponibile (eseguire karen_v8_governance.sql)', { code: cacheError.code ?? null });
  }
  if (!force && cached?.payload) {
    const aggiornato = typeof cached.updated_at === 'string' ? cached.updated_at.slice(0, 10) : '';
    const definitivo = cached.week_closed === true;
    if (definitivo || (!settimanaChiusa && aggiornato === serverDateKey())) {
      return jsonResponse(req, { weekly: cached.payload, cached: true, generatedAt: cached.updated_at, weekClosed: definitivo });
    }
  }

  const materieSnapshot = normalizeMaterie(appState?.materie);
  const contesto = sanitizeWeeklyContext(body.week_context, materieSnapshot, week);
  if (!contesto) return jsonResponse(req, { error: 'Dati della settimana non validi: ricarica la pagina e riprova.' }, 400);
  if (contesto.total_minutes === 0 && contesto.reviews.count === 0) {
    return jsonResponse(req, { error: 'Nessuna sessione registrata in questa settimana: il bilancio si prepara quando c’è qualcosa da guardare.' }, 400);
  }

  const usage = await bumpUsage(admin, userId, 'weekly');
  if (overLimit(usage, 'weekly')) return limitResponse(req, 'weekly');

  const { materie, prompt } = buildWeeklyUserPrompt(contesto, todayKey);
  const result = await callClaudeJson(buildWeeklySystemPrompt(), prompt, 1400, 2200);
  const weekly = result.ok ? sanitizeWeeklyReview(result.parsed, materie) : null;
  if (!weekly) return jsonResponse(req, { error: 'K.A.R.E.N. non è riuscita a preparare il bilancio. Riprova fra poco.' }, 502);

  const generatedAt = new Date().toISOString();
  if (cacheAvailable) {
    const { error: saveError } = await admin
      .from('karen_weekly')
      .upsert(
        { user_id: userId, week_start: week, payload: weekly, model: result.model, week_closed: settimanaChiusa, updated_at: generatedAt },
        { onConflict: 'user_id,week_start' }
      );
    if (saveError) console.warn('karen-oracle (weekly): bilancio non salvato', { code: saveError.code ?? null });
  }
  return jsonResponse(req, { weekly, cached: false, generatedAt, weekClosed: settimanaChiusa });
}

/** Il Daily Briefing: readiness + piano di oggi → testo e direttive. */
async function handleBriefing({ req, body, userId, admin, appState }: Ctx) {
  const targetDate = validateDateParam(body.date);
  if (!targetDate) {
    return jsonResponse(req, { error: "Campo 'date' obbligatorio, formato YYYY-MM-DD (data LOCALE del chiamante)." }, 400);
  }
  if (!isDateWithinServerWindow(targetDate)) {
    return jsonResponse(req, { error: `La data inviata (${targetDate}) non è oggi: controlla data e ora del dispositivo.` }, 400);
  }
  const force = body.force === true;

  // -- Cache del giorno --
  const { data: existing, error: existingError } = await admin
    .from('karen_briefings')
    .select('*')
    .eq('user_id', userId)
    .eq('date', targetDate)
    .maybeSingle();
  if (existingError) {
    // Senza sapere cosa c'è già non si genera: un ripiego potrebbe finire
    // sopra un briefing buono, e la chiamata sfuggirebbe ai contatori.
    console.error('karen-oracle: errore nel controllo cache', { code: existingError.code ?? null });
    return jsonResponse(req, { error: 'Archivio dei briefing non raggiungibile in questo momento: riprova fra poco.' }, 503);
  }

  const existingIsFallback = isFallbackBriefing(existing);
  const retryFallback = !!existing && !force && shouldRetryFallbackBriefing(existing);
  if (existing && !force && !retryFallback) {
    return jsonResponse(req, {
      briefing: existing,
      readiness_band: readinessBand(existing.readiness_score),
      cached: true,
      // Un ripiego appena rinnovato: si riprova, ma non prima di due minuti.
      ...(existingIsFallback ? { fallback: true, warning: 'K.A.R.E.N. ci ha provato meno di due minuti fa: riprova fra poco.' } : {})
    });
  }

  // -- Governance: ogni ramo che chiama Claude si conta — la prima
  //    generazione del giorno, una rigenerazione manuale, un nuovo
  //    tentativo dopo un ripiego. --
  if (!existing) {
    const usage = await bumpUsage(admin, userId, 'briefing');
    if (overLimit(usage, 'briefing')) return limitResponse(req, 'briefing');
  } else {
    const kind: UsageKind = force ? 'regen' : 'retry';
    const usage = await bumpUsage(admin, userId, kind);
    const count = usage.count ?? (force ? (Number(existing.regen_count) || 0) + 1 : 0);
    if (count > USAGE_LIMITS[kind]) {
      return jsonResponse(req, {
        briefing: existing,
        readiness_band: readinessBand(existing.readiness_score),
        cached: true,
        rate_limited: true,
        ...(force
          ? { error: `Limite di ${USAGE_LIMITS.regen} ${LIMIT_MESSAGES.regen}` }
          : { fallback: true, warning: `Limite di ${USAGE_LIMITS.retry} ${LIMIT_MESSAGES.retry}` })
      });
    }
  }

  // -- Dati: biometria e survey di oggi, storico cardiaco e di sonno,
  //    briefing di ieri; lo stato dell'app è già letto (sola lettura). --
  const baselineSince = new Date(Date.parse(`${targetDate}T00:00:00Z`) - HR_BASELINE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const [{ data: bioToday }, { data: subjectiveToday }, { data: hrHistory }, { data: yesterdayBriefing }] = await Promise.all([
    admin
      .from('suit_biometrics')
      .select('sleep_total_min, sleep_deep_min, sleep_rem_min, resting_hr, steps, active_calories')
      .eq('user_id', userId)
      .eq('date', targetDate)
      .maybeSingle(),
    admin
      .from('cadet_subjective_logs')
      .select('focus_level, energy_level, stress_level, muscle_soreness, mood, caffeine_mg')
      .eq('user_id', userId)
      .eq('date', targetDate)
      .maybeSingle(),
    admin
      .from('suit_biometrics')
      .select('resting_hr, sleep_total_min, date')
      .eq('user_id', userId)
      .gte('date', baselineSince)
      .lt('date', targetDate),
    // Il briefing di IERI, non l'ultimo precedente: un consiglio di quattro
    // giorni fa non è "il consiglio di ieri" da verificare.
    admin.from('karen_briefings').select('briefing_text, directives').eq('user_id', userId).eq('date', dateKeyDaysBefore(targetDate, 1)).maybeSingle()
  ]);

  const storico = (hrHistory ?? []) as { resting_hr: number | null; sleep_total_min: number | null }[];
  const hrSamples = storico.map((r) => r.resting_hr).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const baselineHr = hrSamples.length >= HR_BASELINE_MIN_SAMPLES ? Math.round(hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length) : null;
  const sleepTarget = computePersonalSleepTarget(storico.map((r) => r.sleep_total_min));

  const readiness = computeReadinessScore(bioToday ?? null, baselineHr, subjectiveToday ?? null, sleepTarget.target);
  const readinessKnown = readinessIsKnown(readiness);
  const band = readinessBand(readiness.score);

  const materieSnapshot = normalizeMaterie(appState?.materie);
  const plan = sanitizePlanContext(body.plan_context, materieSnapshot, targetDate);
  const historicalWindow = computeHistoricalStudyWindow(appState?.starLog, targetDate);
  const studyFocus = selectStudyFocusCandidates(appState?.materie, targetDate, plan);
  const yesterdayOutcome = computeYesterdayOutcome(appState?.starLog, targetDate, yesterdayBriefing?.directives ?? null, appState?.materie);

  const result = await callClaudeJson(
    buildSystemPrompt(),
    buildUserPrompt({
      date: targetDate,
      readiness,
      band,
      bio: bioToday ?? null,
      subjective: subjectiveToday ?? null,
      previousBriefing: yesterdayBriefing?.briefing_text ?? null,
      historicalWindow,
      studyFocus,
      yesterdayOutcome,
      plan
    }),
    1600,
    2600
  );

  let briefingText = '';
  let tacticalAdvice = '';
  let directives: Directives | null = null;
  let model: string | null = null;
  if (result.ok && result.parsed && typeof result.parsed === 'object') {
    const parsed = result.parsed as Record<string, unknown>;
    briefingText = cleanUserText(parsed.briefing_text, 1500);
    tacticalAdvice = cleanUserText(parsed.tactical_advice, 1500);
    if (briefingText && tacticalAdvice) {
      directives = sanitizeDirectives(parsed, band, historicalWindow, studyFocus, { readinessKnown });
      model = result.model;
    } else {
      console.error('karen-oracle: campi del briefing mancanti nella risposta', { model: result.model });
    }
  }

  if (!directives) {
    // Claude non ha dato un briefing usabile. Un briefing buono già salvato
    // resta com'è: niente ripiego sopra un piano vero.
    if (existing && !existingIsFallback) {
      return jsonResponse(
        req,
        {
          briefing: existing,
          readiness_band: readinessBand(existing.readiness_score),
          cached: true,
          error: 'K.A.R.E.N. non ha risposto: resta valido il briefing già generato oggi. Riprova fra qualche minuto.'
        },
        502
      );
    }
    // Primo giro (o un ripiego da rinnovare): il piano deterministico,
    // dichiarato come tale, così la giornata ha comunque le sue direttive.
    const oggettivi = Math.round((readiness.breakdown.objectiveCompleteness ?? 0) * 100);
    const soggettivi = Math.round((readiness.breakdown.subjectiveCompleteness ?? 0) * 100);
    briefingText = readinessKnown
      ? `K.A.R.E.N. non è raggiungibile in questo momento: ecco il piano di ripiego. Readiness di oggi ${readiness.score}/100 (${band}), dati oggettivi ${oggettivi}%, soggettivi ${soggettivi}%.`
      : `K.A.R.E.N. non è raggiungibile in questo momento: ecco il piano di ripiego. Readiness non misurata oggi (pochi dati): vale il piano, senza correzioni.`;
    tacticalAdvice =
      readinessKnown && band === 'CRITICO'
        ? 'Riduci il carico di oggi e privilegia sessioni brevi: il piano può attendere qualche ora in più.'
        : 'Segui il piano di oggi dall’inizio: prima i ripassi in scadenza, poi la prima materia della giornata.';
    directives = defaultDirectivesForBand(band, historicalWindow, studyFocus, { readinessKnown });
  }

  const nextRegenCount = existing ? (Number(existing.regen_count) || 0) + (force ? 1 : 0) : 0;
  const { data: saved, error: saveError } = await admin
    .from('karen_briefings')
    .upsert(
      {
        user_id: userId,
        date: targetDate,
        readiness_score: readiness.score,
        briefing_text: briefingText,
        tactical_advice: tacticalAdvice,
        score_breakdown: { ...readiness.breakdown, known: readinessKnown, sleepTargetPersonalized: sleepTarget.personalized },
        directives: { ...directives, generated_at: new Date().toISOString(), model },
        regen_count: nextRegenCount
      },
      { onConflict: 'user_id,date' }
    )
    .select()
    .single();

  if (saveError) {
    console.error('karen-oracle: errore salvataggio karen_briefings', { code: saveError.code ?? null });
    return jsonResponse(req, { error: 'Briefing generato ma non salvato: riprova.' }, 500);
  }

  const fallback = directives.source === 'fallback';
  return jsonResponse(req, {
    briefing: saved,
    readiness_band: band,
    readiness_known: readinessKnown,
    cached: false,
    fallback,
    ...(fallback ? { warning: 'K.A.R.E.N. non ha risposto: piano di ripiego. Riprova fra qualche minuto.' } : {})
  });
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
const MODES = new Set(['briefing', 'quiz', 'oral', 'oral_eval', 'weekly']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Metodo non consentito. Usa POST.' }, 405);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
    console.error('karen-oracle: variabili d’ambiente mancanti', {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasAnonKey: !!SUPABASE_ANON_KEY,
      hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
      hasAnthropicKey: !!ANTHROPIC_API_KEY
    });
    return jsonResponse(req, { error: 'Configurazione server incompleta: un secret richiesto non è impostato (vedi supabase secrets set).' }, 500);
  }

  try {
    // -- 1. Chi chiama: dal JWT, mai un user_id dal body --
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse(req, { error: 'Authorization header mancante.' }, 401);
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
      error: userError
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      // 401 esplicito: il client può rinnovare la sessione e ritentare.
      return jsonResponse(req, { error: 'Sessione non valida o scaduta.', code: 'INVALID_SESSION' }, 401);
    }

    // -- 2. V42 — e deve essere un utente ammesso --
    if (!isUserAllowed({ id: user.id, email: user.email ?? null }, ALLOWED_USER_IDS, ALLOWED_EMAILS, ALLOW_ALL)) {
      if (!ALLOWLIST_SET) {
        return jsonResponse(
          req,
          {
            error: 'K.A.R.E.N. non è ancora abilitata per nessun account: imposta il secret KAREN_ALLOWED_EMAILS con la tua email (supabase secrets set KAREN_ALLOWED_EMAILS=…).',
            code: 'ALLOWLIST_NOT_SET'
          },
          403
        );
      }
      console.warn('karen-oracle: accesso negato a un utente fuori allowlist');
      return jsonResponse(req, { error: 'Questo account non è abilitato a K.A.R.E.N.', code: 'NOT_ALLOWED' }, 403);
    }

    // -- 3. Body e modalità --
    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return jsonResponse(req, { error: 'Body JSON mancante o non valido.' }, 400);
    const body = raw as Record<string, unknown>;
    const mode = typeof body.mode === 'string' ? body.mode : 'briefing';
    if (!MODES.has(mode)) return jsonResponse(req, { error: `Modalità sconosciuta: ${cleanUserText(mode, 20)}.` }, 400);

    // -- 4. Service Role (karen_briefings è SELECT-only per il client) e
    //       stato dell'app in SOLA LETTURA: la fonte di verità è il database. --
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData, error: stateError } = await admin.from('user_data').select('app_state').eq('user_id', user.id).maybeSingle();
    if (stateError) console.warn('karen-oracle: stato dell’app non leggibile', { code: stateError.code ?? null });
    const appState = userData?.app_state && typeof userData.app_state === 'object' ? (userData.app_state as Record<string, unknown>) : null;

    const ctx: Ctx = { req, body, userId: user.id, admin, appState };
    switch (mode) {
      case 'quiz':
        return await handleQuiz(ctx);
      case 'oral':
        return await handleOral(ctx);
      case 'oral_eval':
        return await handleOralEval(ctx);
      case 'weekly':
        return await handleWeekly(ctx);
      default:
        return await handleBriefing(ctx);
    }
  } catch (err) {
    console.error('karen-oracle: errore inatteso', { name: err instanceof Error ? err.name : typeof err });
    return jsonResponse(req, { error: 'Errore interno di K.A.R.E.N.' }, 500);
  }
});
