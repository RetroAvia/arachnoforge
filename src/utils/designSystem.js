/**
 * ArachnoForge Design System — V41 "Premium Stark Tech".
 *
 * Le ricette vivono in index.css (layer `components`, classi `ds-*`):
 * qui restano i NOMI che il resto dell'app importa da sempre, così ogni
 * pagina ha cambiato aspetto senza cambiare un solo import.
 *
 * Regole della V41:
 *  - superfici piatte e ordinate: pannello, bordo sottile neutro, ombra
 *    morbida — niente vetro sfocato né aloni al neon dentro le pagine;
 *  - un solo colore "forte" per schermata: il rosso dell'azione principale;
 *    il blu informa, l'oro premia;
 *  - testo dei bottoni in minuscolo con peso semibold (niente maiuscolo
 *    spaziato), etichette di sezione piccole in maiuscoletto;
 *  - i colori di ruolo passano SEMPRE dalle variabili del costume attivo
 *    (Classic / Symbiote / 2099 / Maximum Carnage).
 */

/** Sfondo della Shell. */
export const APP_BG = 'bg-app text-slate-200';

/** Pannello standard, con padding. */
export const CARD = 'ds-card';

/** Pannello senza padding (testata e corpo gestiti a parte). */
export const CARD_NOPAD = 'ds-card-nopad';

/**
 * Pannello a cui il chiamante aggiunge il PROPRIO colore di bordo (stato
 * di un nodo, esito di una simulazione): le utility Tailwind vincono sul
 * layer `components`, quindi basta accostarle.
 */
export const CARD_BARE = 'ds-card';

/** Pannello d'allerta (critico, Goblin Protocol, Enrage). */
export const CARD_ALERT = 'ds-card ds-card-alert';

/** Pannello cliccabile (hover rialzato). */
export const CARD_INTERACTIVE = 'ds-card ds-card-interactive';

/** Pozzetto incassato dentro un pannello. */
export const WELL = 'ds-well';

/** Bottoni. */
export const BTN_PRIMARY = 'ds-btn ds-btn-primary';
export const BTN_SECONDARY = 'ds-btn ds-btn-secondary';
export const BTN_SUCCESS = 'ds-btn ds-btn-success';
export const BTN_AMBER = 'ds-btn ds-btn-amber';
export const BTN_GHOST = 'ds-btn ds-btn-ghost';
export const BTN_DANGER = 'ds-btn ds-btn-danger';
export const BTN_QUIET = 'ds-btn ds-btn-quiet';
/** Modificatori di taglia, da accostare a un BTN_*. */
export const BTN_SM = 'ds-btn-sm';
export const BTN_LG = 'ds-btn-lg';
/** Bottone-icona quadrato (chiudi, elimina, aggiungi). */
export const ICON_BTN = 'ds-icon-btn';

/** Campi. */
export const INPUT = 'ds-input';
export const INPUT_SM = 'ds-input ds-input-sm';
export const LABEL = 'ds-label';

/** Tipografia. */
export const H1 = 'ds-h1';
export const H2 = 'ds-h2';
export const EYEBROW = 'ds-eyebrow';
export const SUBTITLE = 'ds-subtitle';

/** Riquadro icona nella testata di una card. */
export const ICON_TILE = 'ds-icon-tile';

/** Badge/pillole semantiche. */
export const BADGE = {
  blue: 'ds-badge ds-badge-blue',
  red: 'ds-badge ds-badge-red',
  green: 'ds-badge ds-badge-green',
  amber: 'ds-badge ds-badge-amber',
  slate: 'ds-badge ds-badge-slate',
  cyan: 'ds-badge ds-badge-cyan',
  violet: 'ds-badge ds-badge-violet'
};

/**
 * Bagliore dietro un nodo completato. V41: un alone appena accennato,
 * non più una nebulosa.
 */
export const RADIAL_GLOW = {
  green: 'absolute -inset-2 rounded-full bg-emerald-500/10 blur-xl pointer-events-none',
  blue: 'absolute -inset-2 rounded-full bg-secondary/10 blur-xl pointer-events-none',
  red: 'absolute -inset-2 rounded-full bg-primary/10 blur-xl pointer-events-none',
  amber: 'absolute -inset-2 rounded-full bg-accent/10 blur-xl pointer-events-none',
  cyan: 'absolute -inset-2 rounded-full bg-cyan-500/10 blur-xl pointer-events-none'
};
