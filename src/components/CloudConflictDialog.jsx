import React, { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';
import { useOverlayLayer } from './Modal.jsx';
import { BTN_PRIMARY, BTN_GHOST } from '../utils/designSystem.js';

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

function VersionCard({ title, subtitle, summary, tone }) {
  const accent = tone === 'local' ? 'border-secondary/50 bg-secondary/[0.07]' : 'border-accent/50 bg-accent/[0.07]';
  const label = tone === 'local' ? 'text-secondary' : 'text-accent';
  return (
    <div className={`flex-1 min-w-[200px] rounded-xl border p-4 ${accent}`}>
      <p className={`text-[11px] font-mono tracking-[0.2em] ${label}`}>{title}</p>
      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{subtitle}</p>
      {summary ? (
        <dl className="mt-3 space-y-1.5 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Livello</dt>
            <dd className="font-mono text-slate-200">
              {summary.livello} · {summary.xp} XP
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Materie</dt>
            <dd className="font-mono text-slate-200">{summary.materie}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Nodi completati</dt>
            <dd className="font-mono text-slate-200">
              {summary.completati}/{summary.nodi}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Sessioni registrate</dt>
            <dd className="font-mono text-slate-200">{summary.sessioni}</dd>
          </div>
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
    >
      <div className="absolute inset-0 bg-surface/85 backdrop-blur-md" />
      <div
        ref={panelRef}
        className="relative w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain af-scroll bg-surface/90 backdrop-blur-lg border border-accent/40 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] af-holo-alert-in"
      >
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
        <div className="relative p-5 sm:p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/40 flex items-center justify-center text-accent shrink-0">
              <Icon name="cloudOff" className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-mono tracking-[0.2em] text-accent">SINCRONIZZAZIONE IN CONFLITTO</p>
              <h2 id="af-cloud-conflict-title" className="text-xl font-extrabold text-white tracking-tight mt-0.5">
                {conflict.sameDevice ? 'ArachnoForge è aperto anche in un\u2019altra finestra' : 'Il profilo è stato modificato altrove'}
              </h2>
              <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                {conflict.sameDevice
                  ? 'Un\u2019altra scheda o finestra di ArachnoForge su questo stesso dispositivo (per esempio l\u2019app installata e il browser insieme) ha salvato mentre lavoravi qui.'
                  : 'Un altro dispositivo ha salvato una versione più recente mentre lavoravi qui.'}{' '}
                K.A.R.E.N. non sovrascrive niente da sola: scegli quale versione tenere. Quella scartata non è recuperabile.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <VersionCard
              tone="local"
              title="QUESTO DISPOSITIVO"
              subtitle="Il lavoro appena fatto, non ancora sincronizzato."
              summary={localSummary}
            />
            <VersionCard
              tone="remote"
              title="VERSIONE SUL CLOUD"
              subtitle={conflict.sameDevice ? 'Salvata da un\u2019altra finestra di questo dispositivo.' : 'Salvata più di recente da un altro dispositivo.'}
              summary={remoteSummary}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button type="button" onClick={onKeepLocal} className={`flex-1 ${BTN_PRIMARY}`}>
              <Icon name="upload" className="w-5 h-5" />
              Tieni questo dispositivo
            </button>
            <button
              type="button"
              onClick={() => onTakeRemote(conflict.remoteState, conflict.remoteUpdatedAt)}
              disabled={!conflict.remoteState}
              className={`flex-1 ${BTN_GHOST} disabled:opacity-40`}
            >
              <Icon name="download" className="w-5 h-5" />
              Prendi la versione sul Cloud
            </button>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            {conflict.sameDevice
              ? 'Suggerimento: tieni aperta una sola finestra di ArachnoForge alla volta (l\u2019app installata oppure il browser).'
              : 'Suggerimento: tornando su un dispositivo, K.A.R.E.N. carica da sola le modifiche fatte sull\u2019altro se qui non hai niente in sospeso. Il conflitto compare solo se hai modificato su entrambi.'}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
