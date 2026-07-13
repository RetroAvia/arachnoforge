import React from 'react';
import { Icon } from './Icons.jsx';
import { CARD_ALERT, BTN_PRIMARY } from '../utils/designSystem.js';

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
 */
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ArachnoForge — errore di rendering intercettato dal Web-Shooter:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={`${CARD_ALERT} max-w-lg mx-auto mt-10 md:mt-16 text-center space-y-5`}>
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
          <div className="relative w-16 h-16 mx-auto rounded-2xl bg-primary/10 border border-primary/40 flex items-center justify-center text-primary">
            <Icon name="alertTriangle" className="w-8 h-8" />
          </div>
          <h2 className="relative text-xl font-extrabold text-primary tracking-wide">Web-Shooter Inceppato</h2>
          <p className="relative text-base text-slate-400 leading-relaxed">
            Questa pagina ha incontrato un errore imprevisto e si è fermata prima di rompere il resto
            dell'app. I tuoi dati sono al sicuro: puoi tornare allo Stark-Web Terminal e riprovare.
          </p>
          {this.props.onRecover && (
            <button type="button" onClick={this.props.onRecover} className={`relative ${BTN_PRIMARY}`}>
              Torna allo Stark-Web Terminal
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
