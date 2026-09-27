import React, { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';
import { useOverlayLayer } from './Modal.jsx';
import { BTN_PRIMARY, BTN_GHOST } from '../utils/designSystem.js';
import { formatInt } from '../utils/format.js';
import { backupsSupported } from '../utils/localBackups.js';

/**
 * V37.0 — "Due dispositivi, un solo profilo".
 *
 * Fino alla V36 ogni salvataggio era un upsert incondizionato dell'intero
 * `app_state`: con telefono e PC aperti insieme — il caso NORMALE per una
 * PWA installata — l'ultimo che scriveva cancellava il lavoro dell'altro
 * in silenzio. Nessun errore, nessun avviso, solo dati spariti.
 *
 * Ora la scrittura è condizionata al token di versione della riga (vedi
 * `updated_at` in supabase/user_data_v6_optimistic_locking.sql) e, quando
 * fallisce, si arriva qui. Deliberatamente NON esiste una fusione
 * automatica: due `app_state` fusi a mano produrrebbero un profilo mai
 * esistito né su un dispositivo né sull'altro. La scelta resta al
 * Cadetto, con davanti i numeri che servono per farla.
 */
function summarize(state) {
  if (!state || typeof state !== 'object') return null;
  const materie = Array.isArray(state.materie) ? state.materie : [];
  const nodi = materie.reduce((sum, m) => sum + (Array.isArray(m?.sfide) ? m.sfide.length : 0), 0);
  const completati = materie.reduce(
    (sum, m) => sum + (Array.isArray(m?.sfide) ? m.sfide.filter((s) => s?.status === 'COMPLETED').length : 0),
    0
  );
  const sessioni = Array.isArray(state.starLog)
    ? state.starLog.filter((e) => e?.type === 'FOCUS_SESSION').length
    : 0;
  return {
    livello: state.profile?.level ?? '—',
    xp: state.profile?.currentXp ?? 0,
    materie: materie.length,
    nodi,
    completati,
    sessioni
  };
}

/** Righe del confronto: il valore più alto dei due è messo in evidenza. */
const ROWS = [
  { key: 'livello', label: 'Livello', format: (s) => `${s.livello} · ${formatInt(s.xp)} XP`, compare: (s) => (Number(s.livello) || 0) * 1e9 + (Number(s.xp) || 0) },
  { key: 'materie', label: 'Materie', format: (s) => formatInt(s.materie), compare: (s) => s.materie },
  { key: 'completati', label: 'Argomenti completati', format: (s) => `${formatInt(s.completati)} di ${formatInt(s.nodi)}`, compare: (s) => s.completati },
  { key: 'sessioni', label: 'Sessioni registrate', format: (s) => formatInt(s.sessioni), compare: (s) => s.sessioni }
];

function VersionCard({ title, subtitle, summary, other, tone }) {
  const dot = tone === 'local' ? 'bg-secondary' : 'bg-accent';
  return (
    <div className="flex-1 min-w-[220px] ds-well p-4">
      <p className="text-sm font-semibold text-slate-100 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
        {title}
      </p>
      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{subtitle}</p>
      {summary ? (
        <dl className="mt-3.5 space-y-2 text-[13px]">
          {ROWS.map((row) => {
            const mine = row.compare(summary);
            const theirs = other ? row.compare(other) : mine;
            const higher = mine > theirs;
            return (
              <div key={row.key} className="flex justify-between gap-3">
                <dt className="text-slate-500">{row.label}</dt>
                <dd className={`ds-num text-right ${higher ? 'text-white font-semibold' : 'text-slate-300'}`}>{row.format(summary)}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-3 text-xs text-slate-500 italic">Contenuto non leggibile.</p>
      )}
    </div>
  );
}

export default function CloudConflictDialog({ conflict, localState, onKeepLocal, onTakeRemote }) {
  const localSummary = useMemo(() => summarize(localState), [localState]);
  const remoteSummary = useMemo(() => summarize(conflict?.remoteState), [conflict]);
  const panelRef = useRef(null);
  // V39 — stessa pila delle modali (Esc non chiude: una delle due scelte
  // va fatta), focus portato dentro il dialogo e trattenuto lì.
  useOverlayLayer({ open: !!conflict, onClose: null, panelRef, priority: 100 });

  if (!conflict || typeof document === 'undefined') return null;

  // V39 — portal su document.body e altezza massima con scorrimento
  // interno: su un telefono in orizzontale i due riepiloghi affiancati
  // superavano lo schermo e i pulsanti di scelta restavano irraggiungibili.
  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="af-cloud-conflict-title"
      aria-describedby="af-cloud-conflict-desc"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[3px]" />
      <div
        ref={panelRef}
        className="relative w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain af-scroll ds-card-nopad !border-accent/35 !shadow-pop af-holo-alert-in"
      >
        <div className="p-5 sm:p-6 space-y-5">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent shrink-0">
              <Icon name="cloudOff" className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="ds-eyebrow !text-accent">Sincronizzazione in conflitto</p>
              <h2 id="af-cloud-conflict-title" className="text-lg sm:text-xl font-bold text-white tracking-tight mt-1 leading-snug">
                {conflict.sameDevice ? 'ArachnoForge è aperto anche in un’altra finestra' : 'Il profilo è stato modificato altrove'}
              </h2>
              <p id="af-cloud-conflict-desc" className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                {conflict.sameDevice
                  ? 'Un’altra scheda o finestra di ArachnoForge su questo dispositivo (per esempio l’app installata e il browser insieme) ha salvato mentre lavoravi qui.'
                  : 'Un altro dispositivo ha salvato una versione più recente mentre lavoravi qui.'}{' '}
                K.A.R.E.N. non unisce le due versioni da sola: scegli quale tenere.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <VersionCard
              tone="local"
              title="Questo dispositivo"
              subtitle="Il lavoro appena fatto, non ancora sincronizzato."
              summary={localSummary}
              other={remoteSummary}
            />
            <VersionCard
              tone="remote"
              title="Versione sul Cloud"
              subtitle={conflict.sameDevice ? 'Salvata da un’altra finestra di questo dispositivo.' : 'Salvata più di recente da un altro dispositivo.'}
              summary={remoteSummary}
              other={localSummary}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button type="button" onClick={onKeepLocal} className={`flex-1 ${BTN_PRIMARY}`}>
              <Icon name="upload" className="w-4 h-4" />
              Tieni questo dispositivo
            </button>
            <button
              type="button"
              onClick={() => onTakeRemote(conflict.remoteState, conflict.remoteUpdatedAt)}
              disabled={!conflict.remoteState}
              className={`flex-1 ${BTN_GHOST}`}
            >
              <Icon name="download" className="w-4 h-4" />
              Prendi la versione sul Cloud
            </button>
          </div>

          <div className="space-y-1.5 text-xs text-slate-500 leading-relaxed">
            <p className="flex items-start gap-2">
              <Icon name="history" className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
              <span>
                {backupsSupported()
                  ? 'La versione che scarti non va persa: ne salvo una copia fra i punti di ripristino di questo dispositivo (Impostazioni › Backup e dati).'
                  : 'Questo browser non permette copie di sicurezza locali: la versione che scarti non sarà recuperabile.'}
              </span>
            </p>
            <p className="flex items-start gap-2">
              <Icon name="info" className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
              <span>
                {conflict.sameDevice
                  ? 'Per evitarlo, tieni aperta una sola finestra di ArachnoForge alla volta (l’app installata oppure il browser).'
                  : 'Tornando su un dispositivo, K.A.R.E.N. carica da sola le modifiche fatte sull’altro se qui non hai niente in sospeso: il conflitto compare solo se hai modificato su entrambi.'}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
