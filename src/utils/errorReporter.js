import { supabase } from './supabaseClient.js';

/**
 * V35.2 — "Blindatura & Governance": osservabilità di base lato client,
 * senza alcun SDK di terze parti (Sentry e simili — nessun accesso
 * npm/vendor esterno disponibile in questo giro di lavoro). Riusa
 * l'infrastruttura già presente (client Supabase singleton) per scrivere
 * su `client_error_logs` (vedi supabase/suit_telemetry_schema_v5_error_logs.sql).
 *
 * Principi:
 *  - Fire-and-forget: MAI lanciare, MAI bloccare il chiamante (un errore
 *    nel reporter di errori sarebbe l'ironia peggiore).
 *  - Dedup in-sessione: la stessa identica coppia (source, message, inizio
 *    stack) non viene reinviata più volte nella stessa scheda — evita di
 *    inondare la tabella se un errore si ripete a ogni render/frame.
 *  - Tetto per sessione: oltre MAX_CLIENT_ERROR_REPORTS_PER_SESSION invii,
 *    il reporter si auto-disattiva silenziosamente per il resto della
 *    sessione — nessun rischio di costo/crescita tabella incontrollata da
 *    un loop di errori patologico.
 */

const MAX_CLIENT_ERROR_REPORTS_PER_SESSION = 20;

const _seenFingerprints = new Set();
let _reportCount = 0;

function fingerprint({ source, message, stack }) {
  return `${source || ''}:${message || ''}:${(stack || '').slice(0, 200)}`;
}

/**
 * Segnala un errore client-side a `client_error_logs`. Non lancia mai,
 * non ritorna nulla di significativo (fire-and-forget) — sicuro da
 * chiamare da qualunque punto (error boundary, listener globali).
 */
export function reportClientError({ message, stack, componentStack, source, extra } = {}) {
  try {
    if (!message) return;
    if (_reportCount >= MAX_CLIENT_ERROR_REPORTS_PER_SESSION) return;

    const fp = fingerprint({ source, message, stack });
    if (_seenFingerprints.has(fp)) return;
    _seenFingerprints.add(fp);
    _reportCount += 1;

    // Fire-and-forget: non blocchiamo mai il chiamante (né un error
    // boundary né un listener globale) per attendere l'insert di rete.
    void (async () => {
      try {
        let userId = null;
        try {
          const { data } = await supabase.auth.getSession();
          userId = data?.session?.user?.id ?? null;
        } catch {
          // Nessuna sessione leggibile: l'errore resta comunque loggato
          // con user_id = null (colonna nullable, vedi schema v5).
        }

        await supabase.from('client_error_logs').insert({
          user_id: userId,
          source: source || 'unknown',
          message: String(message).slice(0, 2000),
          stack: stack ? String(stack).slice(0, 4000) : null,
          component_stack: componentStack ? String(componentStack).slice(0, 4000) : null,
          page_path: typeof window !== 'undefined' ? window.location?.hash || window.location?.pathname : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          extra: extra && typeof extra === 'object' ? extra : {}
        });
      } catch {
        // Silenzioso per design: se anche il logging di errore fallisce
        // (rete assente, RLS, tabella non ancora migrata sul progetto
        // dell'utente...), non deve mai propagare né disturbare l'app.
      }
    })();
  } catch {
    // Difesa estrema: reportClientError stesso non deve MAI lanciare.
  }
}

export default reportClientError;
