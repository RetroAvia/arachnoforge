import React from 'react';
import { Icon } from '../../components/Icons.jsx';
import Dropdown from '../../components/Dropdown.jsx';
import { BADGE, INPUT, INPUT_SM, LABEL } from '../../utils/designSystem.js';
import { FORMATO_ESAME, FORMATO_ESAME_META, ESITO_APPELLO, createAppello } from '../../utils/appelli.js';
import { todayDateOnlyKey } from '../../utils/dateUtils.js';

// =====================================================================
// V42 — GLI APPELLI DI UNA MATERIA, nel form della materia.
//
// Una data sola non bastava: scritto e orale sono prove diverse a giorni
// di distanza, e ogni sessione ha più appelli. Qui scegli il formato
// dell'esame e metti tutti gli appelli che conosci; quello selezionato è
// l'obiettivo del piano. Se va male, l'obiettivo passa al successivo con
// un click (Mission Control te lo chiede dopo la data).
// =====================================================================

const FORMATI = [
  FORMATO_ESAME.SCRITTO_ORALE,
  FORMATO_ESAME.SOLO_SCRITTO,
  FORMATO_ESAME.SOLO_ORALE,
  FORMATO_ESAME.PROGETTO_ORALE,
  FORMATO_ESAME.IDONEITA
];

const ESITO_BADGE = {
  [ESITO_APPELLO.SUPERATO]: { cls: BADGE.green, label: 'Superato' },
  [ESITO_APPELLO.NON_SUPERATO]: { cls: BADGE.red, label: 'Non superato' },
  [ESITO_APPELLO.IN_ATTESA]: { cls: BADGE.amber, label: 'In attesa di esito' }
};

/**
 * @param {object} props
 * @param {Array}  props.appelli   [{ id, scritto, orale, nota, esito }]
 * @param {string} props.targetId  id dell'appello obiettivo
 * @param {string} props.formato   FORMATO_ESAME
 * @param {(next:{appelli:Array, targetId:string|null}) => void} props.onChange
 * @param {(f:string) => void} props.onFormato
 * @param {boolean} [props.formatoBloccato] idoneità imposta dal piano di studi
 */
export default function AppelliEditor({ appelli = [], targetId = null, formato = FORMATO_ESAME.SCRITTO_ORALE, onChange, onFormato, formatoBloccato = false }) {
  const meta = FORMATO_ESAME_META[formato] || FORMATO_ESAME_META.SCRITTO_ORALE;
  const oggi = todayDateOnlyKey();
  // Con una sola prova, la data vive nel campo che il formato usa.
  const soloOrale = meta.haOrale && !meta.haScritto;
  const dueProve = meta.haScritto && meta.haOrale;

  const aggiorna = (id, campo, valore) => {
    const lista = appelli.map((a) => (a.id === id ? { ...a, [campo]: valore || null } : a));
    onChange({ appelli: lista, targetId });
  };
  const aggiungi = () => {
    const nuovo = createAppello({});
    const lista = [...appelli, nuovo];
    // Il primo appello (o il primo ancora davanti) diventa l'obiettivo.
    const target = targetId && lista.some((a) => a.id === targetId) ? targetId : nuovo.id;
    onChange({ appelli: lista, targetId: target });
  };
  const rimuovi = (id) => {
    const lista = appelli.filter((a) => a.id !== id);
    const target = targetId === id ? lista.find((a) => (a.orale || a.scritto || '') >= oggi)?.id || lista[0]?.id || null : targetId;
    onChange({ appelli: lista, targetId: target });
  };

  return (
    <div className="space-y-3">
      <div>
        <span className={LABEL}>Formato dell’esame</span>
        <Dropdown
          value={formato}
          onChange={onFormato}
          options={FORMATI.map((f) => ({ value: f, label: FORMATO_ESAME_META[f].label }))}
          disabled={formatoBloccato}
          ariaLabel="Formato dell'esame"
        />
        {formatoBloccato && <p className="text-xs text-slate-500 mt-1.5">Nel piano di studi questo esame è un’idoneità: nessun voto, non entra nella media.</p>}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className={LABEL + ' !mb-0'}>Appelli</span>
        <button type="button" onClick={aggiungi} className="ds-btn ds-btn-ghost ds-btn-sm">
          <Icon name="plus" className="w-3.5 h-3.5" />
          Aggiungi appello
        </button>
      </div>

      {appelli.length === 0 ? (
        <p className="text-xs text-slate-500 leading-relaxed rounded-lg border border-dashed border-line px-3 py-2.5">
          Nessun appello: la materia resta fuori dal piano automatico (puoi comunque studiarla). Aggiungi le date della sessione appena le conosci.
        </p>
      ) : (
        <ul className="space-y-2">
          {appelli.map((a, i) => {
            const passato = (a.orale || a.scritto || '9999') < oggi;
            const esito = a.esito ? ESITO_BADGE[a.esito] : null;
            const obiettivo = a.id === targetId;
            return (
              <li key={a.id} className={`rounded-xl border px-3 py-2.5 ${obiettivo ? 'border-secondary/45 bg-secondary/[0.05]' : 'border-line bg-surface'}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input type="radio" name="af-appello-target" checked={obiettivo} onChange={() => onChange({ appelli, targetId: a.id })} />
                    {obiettivo ? <span className="font-semibold text-secondary">Obiettivo del piano</span> : `Appello ${i + 1}`}
                  </label>
                  <span className="flex items-center gap-1.5">
                    {esito && <span className={esito.cls}>{esito.label}</span>}
                    {!esito && passato && <span className={BADGE.slate}>Passato</span>}
                    <button type="button" onClick={() => rimuovi(a.id)} className="ds-icon-btn !w-8 !h-8 hover:!text-primary" aria-label={`Rimuovi appello ${i + 1}`}>
                      <Icon name="trash" className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
                <div className={`grid gap-2.5 ${dueProve ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                  {!soloOrale && (
                    <label className="block">
                      <span className="block text-[11px] text-slate-500 mb-1">{meta.primaLabel || 'Scritto'}</span>
                      <input type="date" value={a.scritto || ''} onChange={(e) => aggiorna(a.id, 'scritto', e.target.value)} className={INPUT_SM} />
                    </label>
                  )}
                  {meta.haOrale && (
                    <label className="block">
                      <span className="block text-[11px] text-slate-500 mb-1">{meta.secondaLabel || 'Orale'}{dueProve ? ' (se già noto)' : ''}</span>
                      <input type="date" value={a.orale || ''} min={a.scritto || undefined} onChange={(e) => aggiorna(a.id, 'orale', e.target.value)} className={INPUT_SM} />
                    </label>
                  )}
                </div>
                <input
                  type="text"
                  value={a.nota || ''}
                  maxLength={80}
                  onChange={(e) => aggiorna(a.id, 'nota', e.target.value)}
                  placeholder="Nota (aula, prenotazione entro…)"
                  className={`${INPUT} !py-1.5 !text-xs mt-2`}
                />
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-slate-500 leading-relaxed">
        Il piano lavora per la prossima prova ancora davanti: prima lo scritto, poi l’orale dello stesso appello. Metti anche gli appelli successivi: se uno va
        male, l’obiettivo passa al seguente senza riscrivere nulla.
      </p>
    </div>
  );
}
