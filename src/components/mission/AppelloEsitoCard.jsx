import React, { useState } from 'react';
import { Icon } from '../Icons.jsx';
import { BTN_GHOST, BTN_SECONDARY, BTN_SUCCESS, BTN_SM, INPUT_SM } from '../../utils/designSystem.js';
import { ESITO_APPELLO, appelloLabel, nextAppelloAfter } from '../../utils/appelli.js';
import { isUngradedMateria } from '../../data/vanvitelliCourseMap.js';
import { MIN_VOTO, MAX_VOTO } from '../../utils/gpaEngine.js';
import { formatDateShort } from '../../utils/dateUtils.js';

/**
 * V42 — "COM'È ANDATO L'ESAME?"
 *
 * Fino alla V41 una data d'esame passata restava lì: il piano la trattava
 * come "appello scaduto" e il resto andava aggiornato a mano. Ora, dopo
 * l'appello, l'app chiede l'esito in un gesto:
 *  - Superato (col voto, se l'esame ne ha uno): la materia esce dal piano
 *    e il voto entra nella media;
 *  - Non superato: l'obiettivo passa al prossimo appello in calendario e
 *    il piano si ricalcola da lì;
 *  - Aspetto l'esito: te lo richiede fra qualche giorno.
 */
function EsitoRow({ voce, todayKey, onEsito }) {
  const { materia, appello } = voce;
  const [votoAperto, setVotoAperto] = useState(false);
  const [voto, setVoto] = useState('');
  const [lode, setLode] = useState(false);
  const senzaVoto = isUngradedMateria(materia);
  const prossimo = nextAppelloAfter(materia, appello, todayKey);
  const fmt = (d) => formatDateShort(d, todayKey);
  const votoNum = Number(voto);
  const votoValido = Number.isInteger(votoNum) && votoNum >= MIN_VOTO && votoNum <= MAX_VOTO;

  return (
    <div className="rounded-xl border border-secondary/30 bg-secondary/[0.05] px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="ds-icon-tile text-secondary">
          <Icon name="flag" className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Com’è andato l’esame di {materia.nome}?</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Appello del {appelloLabel(appello, fmt)}
            {voce.giorniFa > 0 ? ` · ${voce.giorniFa === 1 ? 'ieri' : `${voce.giorniFa} giorni fa`}` : ''}
          </p>
          {votoAperto ? (
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <label className="text-xs text-slate-400" htmlFor={`af-voto-${appello.id}`}>
                Voto
              </label>
              <input
                id={`af-voto-${appello.id}`}
                type="number"
                min={MIN_VOTO}
                max={MAX_VOTO}
                value={voto}
                onChange={(e) => setVoto(e.target.value)}
                className={`${INPUT_SM} !w-20`}
                autoFocus
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-300">
                <input type="checkbox" checked={lode} disabled={votoNum !== MAX_VOTO} onChange={(e) => setLode(e.target.checked)} />
                Lode
              </label>
              <button
                type="button"
                disabled={!votoValido}
                onClick={() => onEsito(materia, appello, ESITO_APPELLO.SUPERATO, { voto: votoNum, lode: lode && votoNum === MAX_VOTO })}
                className={`${BTN_SUCCESS} ${BTN_SM}`}
              >
                <Icon name="check" className="w-3.5 h-3.5" />
                Registra
              </button>
              <button type="button" onClick={() => setVotoAperto(false)} className={`${BTN_GHOST} ${BTN_SM}`}>
                Indietro
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => (senzaVoto ? onEsito(materia, appello, ESITO_APPELLO.SUPERATO, {}) : setVotoAperto(true))}
                className={`${BTN_SUCCESS} ${BTN_SM}`}
              >
                <Icon name="trophy" className="w-3.5 h-3.5" />
                {senzaVoto ? 'Idoneità ottenuta' : 'Superato'}
              </button>
              <button type="button" onClick={() => onEsito(materia, appello, ESITO_APPELLO.NON_SUPERATO, {})} className={`${BTN_SECONDARY} ${BTN_SM}`}>
                <Icon name="refresh" className="w-3.5 h-3.5" />
                {prossimo ? `Non superato · punto al ${fmt(prossimo.scritto || prossimo.orale)}` : 'Non superato'}
              </button>
              <button type="button" onClick={() => onEsito(materia, appello, ESITO_APPELLO.IN_ATTESA, {})} className={`${BTN_GHOST} ${BTN_SM}`}>
                Aspetto l’esito
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AppelloEsitoCard({ voci = [], todayKey, onEsito }) {
  if (!Array.isArray(voci) || voci.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {voci.map((v) => (
        <EsitoRow key={`${v.materia.id}-${v.appello.id}`} voce={v} todayKey={todayKey} onEsito={onEsito} />
      ))}
    </div>
  );
}
