// =====================================================================
// ArachnoForge — src/utils/studyFocusLive.js (V35.4)
// Riconciliazione LIVE, lato client, del "Piano Argomenti di Oggi" di
// K.A.R.E.N. (karen-oracle, study_focus) con lo stato REALE e attuale di
// app_state.materie — zero chiamate di rete, zero chiamate AI.
//
// Perché esiste: il piano di K.A.R.E.N. viene generato UNA VOLTA al
// giorno (Daily Brain, cache su karen_briefings) per tenere i costi a
// zero chiamate extra. Ma l'utente può completare l'argomento suggerito
// nel giro di pochi minuti — senza questa riconciliazione, la card
// resterebbe "congelata" sull'argomento appena finito per il resto della
// giornata (esattamente il difetto segnalato: "una volta completato, lì
// è rimasto sempre uguale"). Questo modulo prende il payload del giorno
// COSÌ COM'È (mai riscritto) e proietta sopra lo stato vivo dell'albero,
// promuovendo istantaneamente la prossima opzione già pronta nel payload
// (`altre_opzioni`, `ripassi_da_non_saltare`) quando quella corrente
// risulta ormai completata — usando lo stesso motore di stato
// (deriveNodeStatus) già usato dallo Skill Tree per l'utente stesso, cosi'
// "disponibile"/"completato" hanno qui ESATTAMENTE lo stesso significato
// che hanno nella UI dell'albero.
// =====================================================================
import { deriveNodeStatus, NODE_STATUS } from './skillTree.js';

/** Trova materia + sfida dal loro id nello stato vivo. `null` se uno dei
 * due non esiste più (nodo cancellato, materia rimossa) — trattato dal
 * chiamante come "non più verificabile", mai come errore fatale. */
function findLiveNode(materie, materiaId, sfidaId) {
  if (!materiaId || !sfidaId) return null;
  const materia = (materie || []).find((m) => m && m.id === materiaId);
  if (!materia) return null;
  const sfida = (materia.sfide || []).find((s) => s && s.id === sfidaId);
  if (!sfida) return null;
  return { materia, sfida };
}

/** Stato derivato live di un candidato per id, oppure `null` se non
 * verificabile (id mancante o nodo non più trovato) — il chiamante decide
 * come comportarsi in assenza di certezza (qui: sempre "fail open", non
 * nascondere mai un'opzione che non si riesce a verificare). */
function liveStatusOf(materie, materiaId, sfidaId) {
  const found = findLiveNode(materie, materiaId, sfidaId);
  if (!found) return null;
  return deriveNodeStatus(found.sfida, found.materia.sfide || []);
}

/** Un candidato "disponibile" (nuovo argomento) è ancora un lavoro aperto
 * solo se lo Skill Tree lo considera tuttora AVAILABLE dal vivo — se è
 * stato completato (COMPLETED) o si è nel frattempo ribloccato (LOCKED,
 * caso limite: un fratello è stato cancellato/modificato) non va più
 * proposto come lavoro nuovo di oggi. Senza id verificabili si presume
 * ancora aperto (fail open) piuttosto che farlo sparire silenziosamente. */
function isStillOpenTopic(materie, materiaId, sfidaId) {
  const status = liveStatusOf(materie, materiaId, sfidaId);
  // V35.5 — "In Corso": un argomento su cui l'utente ha già investito
  // tempo di Focus resta un "lavoro aperto" a tutti gli effetti — non va
  // scambiato per completato solo perché ha smesso di essere AVAILABLE.
  return status === null || status === NODE_STATUS.AVAILABLE || status === NODE_STATUS.IN_PROGRESS;
}

/** Un ripasso è ancora da fare oggi solo se lo stato live è tornato
 * NEEDS_REVIEW (Spider-Sense) — se è stato nel frattempo valutato lo stato
 * torna COMPLETED (prossima revisione in futuro) e va tolto dalla lista.
 * Stessa logica fail-open dei topic in caso di id non verificabili. */
function isStillDueReview(materie, materiaId, sfidaId) {
  const status = liveStatusOf(materie, materiaId, sfidaId);
  return status === null || status === NODE_STATUS.NEEDS_REVIEW;
}

const GENERIC_PROMOTED_METODO =
  "Richiamo attivo: prova a spiegare l'argomento a voce prima di rileggere gli appunti, poi verifica dove sei stato impreciso. Per un metodo su misura per questo contenuto specifico, usa \"Aggiorna piano\" per una nuova valutazione di K.A.R.E.N.";
const GENERIC_PROMOTED_RATIONALE =
  'Prossima opzione già pronta nel piano di oggi, promossa automaticamente perché il precedente argomento principale risulta completato.';

/**
 * Riconcilia `studyFocusDirective` (lo `study_focus` ricevuto oggi da
 * karen-oracle, invariato) con `materie` (lo stato vivo e corrente di
 * app_state.materie) e restituisce il piano EFFETTIVO da mostrare adesso.
 *
 * Non muta mai `studyFocusDirective` — è una proiezione di sola lettura,
 * ricalcolata ad ogni render da MissionControl mano a mano che `materie`
 * cambia (autosave locale immediato, prima ancora del sync Cloud).
 */
export function resolveLiveStudyFocus(studyFocusDirective, materie) {
  const empty = {
    primary: null,
    promoted: false,
    exhausted: false,
    ripassiDaNonSaltare: [],
    otherOpenOptions: []
  };
  if (!studyFocusDirective) return empty;

  const { argomento_principale: principale, altre_opzioni: altreOpzioni = [], ripassi_da_non_saltare: ripassi = [] } = studyFocusDirective;
  const hadAnyContent = !!principale || altreOpzioni.length > 0 || ripassi.length > 0;

  let primary = null;
  let promoted = false;
  let usedRipassoSfidaId = null;

  // 1) Il principale originale è ancora un lavoro aperto?
  if (principale && isStillOpenTopic(materie, principale.materiaId, principale.sfidaId)) {
    primary = principale;
  } else {
    // 2) Promuovi la prima alternativa fra "altre_opzioni" ancora aperta.
    const nextOption = altreOpzioni.find((o) => isStillOpenTopic(materie, o.materiaId, o.sfidaId));
    if (nextOption) {
      primary = {
        materia: nextOption.materia,
        argomento: nextOption.argomento,
        metodo: GENERIC_PROMOTED_METODO,
        rationale: GENERIC_PROMOTED_RATIONALE,
        sfidaId: nextOption.sfidaId,
        materiaId: nextOption.materiaId
      };
      promoted = true;
    } else {
      // 3) Nessun argomento nuovo rimasto aperto: promuovi il primo ripasso ancora scaduto.
      const nextRipasso = ripassi.find((r) => isStillDueReview(materie, r.materiaId, r.sfidaId));
      if (nextRipasso) {
        primary = {
          materia: nextRipasso.materia,
          argomento: nextRipasso.argomento,
          metodo: nextRipasso.nota,
          rationale: 'Ripasso scaduto promosso a priorità operativa: nessun nuovo argomento resta aperto nel piano di oggi.',
          sfidaId: nextRipasso.sfidaId,
          materiaId: nextRipasso.materiaId
        };
        promoted = true;
        usedRipassoSfidaId = nextRipasso.sfidaId;
      }
    }
  }

  // Le alternative ancora aperte MA non promosse a principale — mostrate
  // come opzioni ulteriori ("più opzioni da studiare"), mai limitate a una sola.
  const otherOpenOptions = altreOpzioni.filter(
    (o) => isStillOpenTopic(materie, o.materiaId, o.sfidaId) && !(primary && primary.sfidaId === o.sfidaId)
  );

  // I ripassi ancora scaduti, esclusa l'eventuale voce già promossa a principale.
  const ripassiDaNonSaltare = ripassi.filter(
    (r) => isStillDueReview(materie, r.materiaId, r.sfidaId) && r.sfidaId !== usedRipassoSfidaId
  );

  const exhausted = !primary && hadAnyContent;

  return { primary, promoted, exhausted, ripassiDaNonSaltare, otherOpenOptions };
}
