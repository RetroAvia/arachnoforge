import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../utils/supabaseClient.js';

/**
 * K.A.R.E.N. AI Engine — Suit Telemetry Hook — v2 "Recovery Survey &
 * Session Hardening" (Fase 3).
 *
 * COMPARTIMENTI STAGNI: unica porta d'accesso alle 3 tabelle biometriche
 * (suit_biometrics, cadet_subjective_logs, karen_briefings) e all'Edge
 * Function karen-oracle. Non tocca ArachnoForgeContext né il reducer del
 * Cloud State esistente (Pillar 3, public.user_data).
 *
 * NOVITÀ v2 (audit Fase 3):
 *   - Timezone Trap #1 (risolto): la data-chiave NON è più calcolata una
 *     sola volta al mount (`useMemo(..., [])`), perché questo hook ora
 *     resta montato per l'intera sessione dentro MissionControl — un
 *     valore congelato avrebbe fatto slittare silenziosamente l'intera
 *     app sul giorno sbagliato subito dopo mezzanotte. La data si
 *     ricalcola ad ogni fetch e un watcher a intervalli rileva il
 *     cambio di giorno per rifare il fetch da solo.
 *   - Session Handling: sottoscrizione a `supabase.auth.onAuthStateChange`
 *     — login/logout/refresh token altrove nell'app fanno ripartire
 *     automaticamente il fetch, mai uno stato "congelato" sull'utente
 *     precedente (o su "nessuna sessione") dopo un cambio di sessione.
 *   - Retry-on-auth-error: se una scrittura fallisce per JWT scaduto,
 *     si tenta UN refresh esplicito della sessione e si ripete la
 *     chiamata una sola volta, prima di arrendersi con un errore chiaro.
 *   - Race guard: triggerOracleScan/saveSubjectiveLog ignorano una nuova
 *     chiamata se una dello stesso tipo è già in volo (mai due upsert o
 *     due scan sovrapposti dallo stesso doppio-click).
 *   - Type Safety: ogni valore in ingresso a saveSubjectiveLog passa da
 *     clampInt/clampCaffeine/sanitizeNotes PRIMA di raggiungere Supabase
 *     — mai un valore fuori range o non numerico spedito alla REST API.
 *   - dataCompleteness (0-1) calcolato QUI, lato client, dalla sola
 *     presenza dei campi grezzi (50% oggettivo: sleep/HR/passi/calorie —
 *     50% soggettivo: focus/energia/stress/soreness) — reattivo
 *     immediatamente al salvataggio della Quick Log, INDIPENDENTE dal
 *     fatto che karen-oracle abbia già girato oggi. Il
 *     `score_breakdown.dataCompleteness` che arriva dentro `briefing` è
 *     un numero concettualmente diverso (quota di PUNTI-PESO disponibili
 *     al momento in cui è stato generato quel briefing, congelata fino
 *     alla prossima rigenerazione) — non sono la stessa metrica e non è
 *     un bug se divergono.
 */

const DEFAULT_READINESS_SCORE = 100;
const DEFAULT_READINESS_BAND = 'OTTIMALE';
const DATE_ROLLOVER_CHECK_MS = 30_000; // controlla il cambio di giorno ogni 30s — leggero, mai un polling di rete

/** Data odierna in formato YYYY-MM-DD, sul fuso orario LOCALE del device
 * (mai `toISOString()`, che normalizza in UTC e farebbe slittare il
 * giorno per chi vive a est di Greenwich in tarda serata). */
function todayDateOnlyKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Stesso vocabolario/soglie di QUOTA_STATUS (useKarenAutoRouter.js) e
 * della funzione gemella in supabase/functions/karen-oracle/index.ts. */
export function readinessBand(score) {
  if (score == null || !Number.isFinite(score)) return DEFAULT_READINESS_BAND;
  if (score >= 75) return 'OTTIMALE';
  if (score >= 45) return 'ATTENZIONE';
  return 'CRITICO';
}

/** Cast + clamp a intero in [min, max]. `null`/`undefined`/NaN -> null
 * (campo non loggato, mai forzato a un valore di default arbitrario). */
function clampInt(value, min, max) {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

/** Caffeina: solo interi >= 0, nessun tetto massimo imposto (esistono
 * dosi legittimamente alte in survey di recovery), ma sempre un numero
 * sano prima di lasciare il client. */
function clampCaffeine(value) {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sanitizeNotes(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 280);
  return trimmed.length > 0 ? trimmed : null;
}

/** Riconosce un errore di sessione/JWT scaduto dai vari formati con cui
 * può arrivare da supabase-js/PostgREST/Edge Functions, per decidere se
 * vale la pena un retry dopo un refresh della sessione. */
function isAuthError(err) {
  if (!err) return false;
  const message = String(err.message || err.error || '').toLowerCase();
  // `err.status`/`err.code` copre i PostgrestError (es. 'PGRST301' = JWT
  // scaduto); `err.context?.status` copre i FunctionsHttpError restituiti
  // da supabase.functions.invoke, che incapsulano la Response HTTP grezza
  // dell'Edge Function (dove karen-oracle risponde 401 su sessione non
  // valida) invece di esporne il messaggio JSON direttamente in `.message`.
  const status = err.status || err.code || err.context?.status;
  return (
    status === 401 ||
    status === 'PGRST301' ||
    message.includes('jwt') ||
    message.includes('token') ||
    message.includes('sessione non valida') ||
    message.includes('invalid_session')
  );
}

/** Estrae il messaggio reale da un errore di supabase.functions.invoke():
 * un FunctionsHttpError espone il body JSON della risposta SOLO tramite
 * `.context` (la Response HTTP grezza), mai in `.message`. Senza questa
 * estrazione esplicita, ogni errore accurato restituito da karen-oracle
 * (400 su data mancante, 502 su Anthropic irraggiungibile, 500 su secret
 * mancante, ecc.) si perderebbe dietro un generico "Edge Function
 * returned a non-2xx status code". */
async function resolveInvokeErrorMessage(err, fallback) {
  if (!err) return fallback;
  try {
    if (err.context && typeof err.context.json === 'function') {
      const body = await err.context.clone().json();
      if (body?.error) return body.error;
    }
  } catch (_readErr) {
    // Corpo non-JSON, già consumato, o context assente — si ricade sotto.
  }
  return err.message || fallback;
}

export function useSuitTelemetry() {
  const [userId, setUserId] = useState(null);
  const [biometrics, setBiometrics] = useState(null);
  const [subjectiveLog, setSubjectiveLog] = useState(null);
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  const scanInFlightRef = useRef(false);
  // V36.0 — "Interrogazione K.A.R.E.N." (generateNodeQuiz): stato e
  // guardia anti-doppio-click dedicati, deliberatamente SEPARATI da
  // quelli della Diagnostica Neurale — sono due chiamate indipendenti e
  // una non deve mai bloccare o confondersi con l'altra.
  const quizInFlightRef = useRef(false);
  const [quizGenerating, setQuizGenerating] = useState(false);
  const saveInFlightRef = useRef(false);
  const currentDateRef = useRef(todayDateOnlyKey());
  const [, forceDateTick] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchAll = useCallback(async (dateOverride) => {
    const targetDate = dateOverride || todayDateOnlyKey();
    currentDateRef.current = targetDate;
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser();

      if (userError || !user) {
        if (mountedRef.current) {
          setUserId(null);
          setBiometrics(null);
          setSubjectiveLog(null);
          setBriefing(null);
        }
        return;
      }

      if (mountedRef.current) setUserId(user.id);

      const [bioRes, subjRes, briefRes] = await Promise.all([
        supabase.from('suit_biometrics').select('*').eq('user_id', user.id).eq('date', targetDate).maybeSingle(),
        supabase.from('cadet_subjective_logs').select('*').eq('user_id', user.id).eq('date', targetDate).maybeSingle(),
        supabase.from('karen_briefings').select('*').eq('user_id', user.id).eq('date', targetDate).maybeSingle()
      ]);

      if (bioRes.error) throw bioRes.error;
      if (subjRes.error) throw subjRes.error;
      if (briefRes.error) throw briefRes.error;

      if (!mountedRef.current) return;
      setBiometrics(bioRes.data || null);
      setSubjectiveLog(subjRes.data || null);
      setBriefing(briefRes.data || null);
    } catch (err) {
      console.error('useSuitTelemetry: errore nel fetch della telemetria', err);
      if (mountedRef.current) {
        setError(err?.message || 'Errore sconosciuto nel recupero della telemetria della tuta.');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Fetch iniziale + refetch automatico su ogni transizione di sessione
  // (login, logout, refresh token, sessione scaduta altrove nell'app) —
  // mai uno stato "congelato" sull'utente sbagliato dopo un cambio account.
  useEffect(() => {
    fetchAll();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      fetchAll();
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, [fetchAll]);

  // Date Rollover Watcher: questo hook può restare montato per ore
  // (MissionControl lo tiene vivo per l'intera sessione, non solo
  // SuitTelemetryView) — un controllo leggero ogni 30s rileva il cambio
  // di giorno locale e rifà il fetch sul nuovo `date`, invece di lasciare
  // l'HUD fermo sulla telemetria di ieri fino al prossimo refresh manuale.
  useEffect(() => {
    const intervalId = setInterval(() => {
      const nowDate = todayDateOnlyKey();
      if (nowDate !== currentDateRef.current) {
        currentDateRef.current = nowDate;
        forceDateTick((t) => t + 1);
        fetchAll(nowDate);
      }
    }, DATE_ROLLOVER_CHECK_MS);
    return () => clearInterval(intervalId);
  }, [fetchAll]);

  /** Invoca karen-oracle per generare (o rigenerare, con `force: true`) il
   * briefing odierno, poi ricarica tutto. Guardia anti-race: una scan già
   * in volo blocca una seconda invocazione concorrente. */
  const triggerOracleScan = useCallback(
    async (options = {}) => {
      if (scanInFlightRef.current) {
        return { data: null, error: 'Diagnostica già in corso.' };
      }
      scanInFlightRef.current = true;
      setScanning(true);
      setError(null);
      const force = options.force === true;
      const targetDate = currentDateRef.current || todayDateOnlyKey();

      const invokeOnce = () =>
        supabase.functions.invoke('karen-oracle', {
          body: { date: targetDate, force }
        });

      try {
        let { data, error: invokeError } = await invokeOnce();

        if (invokeError && isAuthError(invokeError)) {
          // Un solo tentativo di refresh esplicito della sessione, poi
          // un solo retry — mai un loop di refresh infinito.
          await supabase.auth.refreshSession();
          ({ data, error: invokeError } = await invokeOnce());
        }

        if (invokeError) {
          const resolvedMessage = await resolveInvokeErrorMessage(
            invokeError,
            "K.A.R.E.N. non è riuscita a completare la Diagnostica Neurale."
          );
          throw new Error(resolvedMessage);
        }
        if (data?.error) throw new Error(data.error);

        await fetchAll(targetDate);
        return { data, error: null };
      } catch (err) {
        console.error('useSuitTelemetry: errore in triggerOracleScan', err);
        const message = err?.message || "K.A.R.E.N. non è riuscita a completare la Diagnostica Neurale.";
        if (mountedRef.current) setError(message);
        return { data: null, error: message };
      } finally {
        scanInFlightRef.current = false;
        if (mountedRef.current) setScanning(false);
      }
    },
    [fetchAll]
  );

  /**
   * V36.0 — "Interrogazione K.A.R.E.N.": genera on-demand un set di
   * domande di richiamo attivo sul CONTENUTO reale di un nodo.
   *
   * Perché passa da qui e non dal Cloud State: è una chiamata AI, e in
   * questa app ogni chiamata AI vive dietro l'Edge Function (la chiave
   * Anthropic non tocca mai il client). Il risultato però NON viene
   * salvato da questo hook: torna al chiamante, che lo persiste dentro
   * il nodo con l'azione esistente `updateSfidaAndSync` — così le
   * domande restano legate al nodo, disponibili offline ad ogni ripasso
   * successivo, e i "compartimenti stagni" restano intatti (questo hook
   * continua a non scrivere una riga in `user_data`).
   *
   * Guardia anti-race identica a triggerOracleScan: una generazione già
   * in volo blocca un secondo click.
   */
  const generateNodeQuiz = useCallback(async (materiaId, sfidaId) => {
    if (quizInFlightRef.current) {
      return { quiz: null, error: 'Interrogazione già in preparazione.' };
    }
    if (!materiaId || !sfidaId) {
      return { quiz: null, error: 'Nodo non valido.' };
    }
    quizInFlightRef.current = true;
    if (mountedRef.current) setQuizGenerating(true);

    const invokeOnce = () =>
      supabase.functions.invoke('karen-oracle', {
        body: { mode: 'quiz', materiaId, sfidaId }
      });

    try {
      let { data, error: invokeError } = await invokeOnce();
      if (invokeError && isAuthError(invokeError)) {
        await supabase.auth.refreshSession();
        ({ data, error: invokeError } = await invokeOnce());
      }
      if (invokeError) {
        throw new Error(
          await resolveInvokeErrorMessage(invokeError, "K.A.R.E.N. non è riuscita a preparare l'interrogazione.")
        );
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.quiz) throw new Error("Risposta senza interrogazione utilizzabile.");
      return { quiz: data.quiz, thinContext: data.thin_context === true, error: null };
    } catch (err) {
      console.error('useSuitTelemetry: errore in generateNodeQuiz', err);
      return { quiz: null, error: err?.message || "K.A.R.E.N. non è riuscita a preparare l'interrogazione." };
    } finally {
      quizInFlightRef.current = false;
      if (mountedRef.current) setQuizGenerating(false);
    }
  }, []);

  /** Upsert su cadet_subjective_logs, one-shot per giorno (onConflict
   * user_id+date). Ogni campo passa da clamp/sanitize PRIMA di lasciare
   * il client — difesa in profondità anche se il chiamante (UI) ha già
   * validato a monte. Guardia anti-race: un salvataggio già in volo
   * blocca un secondo salvataggio concorrente (es. doppio click). */
  const saveSubjectiveLog = useCallback(
    async ({ focus_level, energy_level, stress_level, muscle_soreness, caffeine_mg, notes } = {}) => {
      if (saveInFlightRef.current) {
        return { data: null, error: 'Salvataggio già in corso.' };
      }
      if (!userId) {
        const message = 'Nessuna sessione Nexus attiva: impossibile salvare la telemetria soggettiva.';
        if (mountedRef.current) setError(message);
        return { data: null, error: message };
      }

      saveInFlightRef.current = true;
      setSaving(true);
      setError(null);

      const targetDate = currentDateRef.current || todayDateOnlyKey();
      const payload = {
        user_id: userId,
        date: targetDate,
        focus_level: clampInt(focus_level, 1, 10),
        energy_level: clampInt(energy_level, 1, 10),
        stress_level: clampInt(stress_level, 1, 10),
        muscle_soreness: clampInt(muscle_soreness, 1, 10),
        caffeine_mg: clampCaffeine(caffeine_mg),
        notes: sanitizeNotes(notes)
      };

      const upsertOnce = () =>
        supabase.from('cadet_subjective_logs').upsert(payload, { onConflict: 'user_id,date' }).select().single();

      try {
        let { data, error: upsertError } = await upsertOnce();

        if (upsertError && isAuthError(upsertError)) {
          await supabase.auth.refreshSession();
          ({ data, error: upsertError } = await upsertOnce());
        }

        if (upsertError) throw upsertError;
        if (mountedRef.current) setSubjectiveLog(data);
        return { data, error: null };
      } catch (err) {
        console.error('useSuitTelemetry: errore in saveSubjectiveLog', err);
        const message = err?.message || 'Impossibile salvare la telemetria soggettiva.';
        if (mountedRef.current) setError(message);
        return { data: null, error: message };
      } finally {
        saveInFlightRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    },
    [userId]
  );

  const refresh = useCallback(() => fetchAll(), [fetchAll]);

  // Fallback elegante: nessun briefing odierno -> 100/OTTIMALE di default,
  // mai un crash o un "NaN%" nella UI. Se il briefing esiste, il suo
  // readiness_score (e la banda da esso derivata) è l'unica fonte di verità.
  const readinessScore = briefing?.readiness_score ?? DEFAULT_READINESS_SCORE;
  const readinessBandValue = briefing ? readinessBand(briefing.readiness_score) : DEFAULT_READINESS_BAND;

  // Data Completeness lato client — 50% oggettivo (4 campi biometrici) +
  // 50% soggettivo (4 campi del Recovery Survey) — reattivo SUBITO dopo
  // saveSubjectiveLog, senza aspettare una nuova scan di karen-oracle.
  const dataCompleteness = useMemo(() => {
    const objectiveFields = [biometrics?.sleep_total_min, biometrics?.resting_hr, biometrics?.steps, biometrics?.active_calories];
    const subjectiveFields = [
      subjectiveLog?.focus_level,
      subjectiveLog?.energy_level ?? subjectiveLog?.mood,
      subjectiveLog?.stress_level,
      subjectiveLog?.muscle_soreness
    ];
    const objectiveScore = objectiveFields.filter((v) => v != null).length / objectiveFields.length;
    const subjectiveScore = subjectiveFields.filter((v) => v != null).length / subjectiveFields.length;
    return Number((objectiveScore * 0.5 + subjectiveScore * 0.5).toFixed(2));
  }, [biometrics, subjectiveLog]);

  return {
    userId,
    hasSession: !!userId,
    biometrics,
    subjectiveLog,
    briefing,
    readinessScore,
    readinessBand: readinessBandValue,
    dataCompleteness,
    loading,
    scanning,
    saving,
    error,
    todayStr: currentDateRef.current,
    triggerOracleScan,
    saveSubjectiveLog,
    generateNodeQuiz,
    quizGenerating,
    refresh
  };
}

export default useSuitTelemetry;
