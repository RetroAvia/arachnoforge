import React from 'react';
import { Icon } from './Icons.jsx';
import { CARD, CARD_ALERT, BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST } from '../utils/designSystem.js';
import { reportClientError } from '../utils/errorReporter.js';
import { isChunkLoadError } from '../utils/lazyPage.js';

/**
 * Rete di sicurezza a livello di pagina. Senza un Error Boundary, un
 * errore non gestito durante il render di UNA pagina (es. Quadrant Hub)
 * fa collassare l'intero albero React di ArachnoForge in uno schermo
 * nero — inclusa la Sidebar e ogni altra pagina, anche quelle sane.
 * Isolare l'errore qui limita il danno alla sola pagina che ha fallito
 * e offre un percorso di recupero immediato senza perdere lo stato
 * applicativo (nessun reload, nessuna perdita di dati in LocalStorage).
 *
 * Va istanziato con `key={currentPage}` dal chiamante: cambiare rotta
 * smonta e rimonta un boundary nuovo di zecca, azzerando `hasError`
 * automaticamente senza bisogno di logica di reset manuale.
 *
 * V40.1 — Due casi distinti:
 *  - download della pagina fallito (deploy nuovo uscito con l'app aperta,
 *    oppure offline): non è un bug, basta ricaricare. Lo diciamo così,
 *    con un pulsante "Ricarica l'app";
 *  - errore vero nel codice: stesso messaggio di prima, più "Riprova"
 *    (che prima mancava: su Mission Control "Torna" non faceva nulla,
 *    perché la rotta non cambiava) e i dettagli tecnici da copiare.
 */
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: '', copiato: false };
    this.reset = this.reset.bind(this);
    this.torna = this.torna.bind(this);
    this.copiaDettagli = this.copiaDettagli.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ArachnoForge — errore di rendering intercettato dal Web-Shooter:', error, info?.componentStack);
    this.setState({ componentStack: info?.componentStack || '' });
    // V35.2 — Osservabilità di base: fire-and-forget, non altera in alcun
    // modo il comportamento di recupero esistente sopra/sotto questa riga.
    reportClientError({
      message: error?.message || String(error),
      stack: error?.stack,
      componentStack: info?.componentStack,
      source: isChunkLoadError(error) ? 'chunk-load' : 'react-error-boundary'
    });
  }

  reset() {
    this.setState({ hasError: false, error: null, componentStack: '', copiato: false });
  }

  torna() {
    if (this.props.onRecover) this.props.onRecover();
    // Se la pagina era già Mission Control la rotta non cambia e il
    // boundary non viene rimontato: lo azzeriamo a mano.
    this.reset();
  }

  dettagli() {
    const { error, componentStack } = this.state;
    const pagina = typeof window !== 'undefined' ? window.location.hash || '/' : '';
    const stack = String(error?.stack || '')
      .split('\n')
      .slice(0, 6)
      .join('\n');
    const componenti = String(componentStack || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' ← ');
    return [`Pagina: ${pagina}`, `Errore: ${error?.message || String(error)}`, stack && `Stack:\n${stack}`, componenti && `Componenti: ${componenti}`]
      .filter(Boolean)
      .join('\n');
  }

  async copiaDettagli() {
    try {
      await navigator.clipboard.writeText(this.dettagli());
      this.setState({ copiato: true });
    } catch {
      // Appunti non disponibili: il testo resta selezionabile qui sotto.
    }
  }

  renderDownloadFallito() {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <div role="alert" className={`${CARD} max-w-lg mx-auto mt-10 md:mt-16 text-center`}>
        <div className="w-12 h-12 mx-auto rounded-xl bg-secondary/10 border border-secondary/30 flex items-center justify-center text-secondary">
          <Icon name={offline ? 'cloudOff' : 'download'} className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-white mt-4">{offline ? 'Pagina non ancora scaricata' : 'Nuova versione disponibile'}</h2>
        <p className="text-sm text-slate-400 leading-relaxed mt-2">
          {offline
            ? 'Sei offline e questa pagina non è ancora stata scaricata su questo dispositivo. Torna online e ricarica l’app.'
            : 'Mentre l’app era aperta è uscito un aggiornamento e questa pagina appartiene ormai alla versione nuova. Ricarica l’app per passare alla nuova versione.'}{' '}
          I tuoi dati sono al sicuro.
        </p>
        <p className="text-xs text-slate-500 mt-2">Se hai un blocco Focus in corso, ricarica quando è finito.</p>
        <div className="flex flex-wrap justify-center gap-2.5 mt-5">
          <button type="button" onClick={() => window.location.reload()} className={BTN_SECONDARY}>
            <Icon name="refresh" className="w-4 h-4" />
            Ricarica l’app
          </button>
          {this.props.onRecover && (
            <button type="button" onClick={this.torna} className={BTN_GHOST}>
              Torna allo Stark-Web Terminal
            </button>
          )}
        </div>
      </div>
    );
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (isChunkLoadError(this.state.error)) return this.renderDownloadFallito();
    return (
      <div role="alert" className={`${CARD_ALERT} max-w-lg mx-auto mt-10 md:mt-16 text-center`}>
        <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
          <Icon name="alertTriangle" className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-white mt-4">Web-Shooter inceppato</h2>
        <p className="text-sm text-slate-400 leading-relaxed mt-2">
          Questa pagina ha incontrato un errore imprevisto e si è fermata prima di rompere il resto dell’app. I tuoi dati sono al
          sicuro: puoi riprovare o tornare allo Stark-Web Terminal.
        </p>
        <div className="flex flex-wrap justify-center gap-2.5 mt-5">
          <button type="button" onClick={this.reset} className={BTN_PRIMARY}>
            <Icon name="refresh" className="w-4 h-4" />
            Riprova
          </button>
          {this.props.onRecover && (
            <button type="button" onClick={this.torna} className={BTN_GHOST}>
              Torna allo Stark-Web Terminal
            </button>
          )}
        </div>
        <details className="ds-well text-left p-3 mt-5">
          <summary className="cursor-pointer text-[13px] text-slate-400 select-none">Dettagli tecnici</summary>
          <pre className="mt-2 max-h-48 overflow-auto af-scroll whitespace-pre-wrap break-words text-xs text-slate-400 font-mono">{this.dettagli()}</pre>
          <button type="button" onClick={this.copiaDettagli} className={`${BTN_GHOST} ds-btn-sm mt-2.5 w-full sm:w-auto`}>
            <Icon name={this.state.copiato ? 'check' : 'note'} className="w-3.5 h-3.5" />
            {this.state.copiato ? 'Copiati' : 'Copia dettagli'}
          </button>
        </details>
      </div>
    );
  }
}
