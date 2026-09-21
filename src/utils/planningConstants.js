// =====================================================================
// ArachnoForge — src/utils/planningConstants.js (V38.0)
//
// Le due costanti su cui poggia OGNI proiezione temporale dell'app,
// estratte in un modulo foglia (nessun import, quindi importabile da
// chiunque senza creare cicli).
//
// Vivevano in `materiaMeta.js`, che però da V38 importa
// `sintesiEngine.js`: quest'ultimo, avendo bisogno dello stesso
// fallback per calcolare la data di chiusura appunti, non poteva
// importarle a ritroso e se l'era riscritte a mano. Due copie dello
// stesso numero in due file diversi sono una divergenza che aspetta
// solo di succedere — si cambia quella "vera" e la data di chiusura
// appunti continua a ragionare sul vecchio valore, senza che niente lo
// segnali. `materiaMeta.js` le ri-esporta, quindi nessun altro file ha
// dovuto cambiare import.
// =====================================================================

/**
 * Monte ore giornaliero sostenibile di default, usato per convertire un
 * totale di ORE in GIORNI di calendario (Fine Prevista, Quota Odierna,
 * data di chiusura appunti, stima di laurea).
 *
 * È solo il FALLBACK: quando `utils/calibration.js` ha abbastanza
 * storico, la capacità reale misurata sulle tue giornate lo sostituisce.
 */
export const HOURS_PER_NODE_DAY = 4.5;

/**
 * Ore di studio individuale per CFU — usato SOLO come fallback per una
 * Materia senza alcun nodo creato (dove non esiste stima dal basso) e
 * per i CFU del piano non ancora mappati nella stima di laurea.
 *
 * V39.0 — da 10 a 15. Un CFU vale 25 ore di lavoro complessivo per
 * definizione (ECTS), di cui in un corso di ingegneria circa un terzo
 * in aula: restano ~15-17 ore di studio individuale. Con 10 ogni
 * materia non ancora mappata risultava più leggera di un terzo, e la
 * stima di laurea era ottimista per costruzione.
 */
export const HOURS_PER_CFU = 15;

/**
 * V39.0 — Ritmo di studio di riserva, in pagine dei TUOI appunti all'ora.
 *
 * Spostato qui da calibration.js perché serve anche a sintesiEngine.js,
 * che calibration.js importa: tenerlo là avrebbe creato un ciclo. È un
 * valore prudente per materiale tecnico universitario e viene usato
 * SOLO finché il ritmo reale non è stato misurato su abbastanza
 * argomenti chiusi.
 */
export const DEFAULT_PAGES_PER_HOUR = 6;
