// =====================================================================
// ArachnoForge — src/utils/aiSaveGuard.js (V43)
// Salva prima di chiedere a K.A.R.E.N.: l'IA legge gli appunti dal Cloud.
// Modulo puro (niente React), così si prova con node --test.
// =====================================================================

/** V43 — Tetto all'attesa del salvataggio prima di una chiamata IA. */
export const SAVE_BEFORE_AI_TIMEOUT_MS = 8000;

/**
 * V43 — Attende il salvataggio registrato (se c'è), al massimo `timeoutMs`.
 * Non lancia mai: un salvataggio fallito o lento non blocca K.A.R.E.N.,
 * che al peggio lavora sull'ultima versione salvata (come prima).
 */
export async function awaitSaveBeforeAi(fn, timeoutMs = SAVE_BEFORE_AI_TIMEOUT_MS) {
  if (typeof fn !== 'function') return false;
  let timer = null;
  try {
    const scaduto = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const esito = await Promise.race([Promise.resolve().then(fn), scaduto]);
    return esito !== false;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
