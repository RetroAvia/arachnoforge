/**
 * V40.1 — Pagine caricate a richiesta, a prova di aggiornamento.
 *
 * Le pagine sono chunk separati (React.lazy): il browser le scarica solo
 * al primo accesso. Se nel frattempo esce un deploy nuovo, i file con
 * l'hash della versione vecchia spariscono dal server e la prima
 * navigazione verso una pagina non ancora aperta falliva con "Failed to
 * fetch dynamically imported module": la pagina mostrava "Web-Shooter
 * Inceppato" anche se non c'era nessun errore nel codice.
 *
 * Due difese:
 *  - `preload()`: dopo l'avvio l'app scarica in sottofondo tutte le
 *    pagine (vedi App.jsx). Una sessione aperta resta così coerente con
 *    la versione con cui è partita, anche se nel frattempo esce un
 *    deploy nuovo;
 *  - `isChunkLoadError()`: se il download fallisce lo stesso (offline, o
 *    deploy uscito nei primi secondi), PageErrorBoundary lo riconosce e
 *    propone di ricaricare invece di mostrare un errore generico.
 */
import { lazy } from 'react';

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk [\w-]+ failed/i;

/** L'errore è un download di codice fallito (non un bug della pagina)? */
export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.chunkLoadFailed === true || error.name === 'ChunkLoadError') return true;
  return CHUNK_ERROR_RE.test(String(error.message || error));
}

/**
 * Come `React.lazy(loader)`, più `Component.preload()`. Lazy e preload
 * condividono lo stesso download: una pagina già precaricata si apre
 * subito. Un preload fallito non resta memorizzato, così un tentativo
 * successivo (per esempio tornati online) riparte da capo.
 */
export function lazyPage(loader) {
  let pending = null;
  const load = () => {
    if (!pending) {
      pending = Promise.resolve()
        .then(loader)
        .catch((error) => {
          pending = null;
          if (error && typeof error === 'object' && isChunkLoadError(error)) {
            try {
              error.chunkLoadFailed = true;
            } catch {
              // Oggetto non estensibile: il messaggio basta a riconoscerlo.
            }
          }
          throw error;
        });
    }
    return pending;
  };
  const Component = lazy(load);
  Component.preload = () => load().then(
    () => true,
    () => false
  );
  return Component;
}

export default lazyPage;
