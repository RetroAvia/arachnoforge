import React, { useId, useMemo } from 'react';
import { Icon } from '../../components/Icons.jsx';
import { INPUT, INPUT_SM, CARD_NOPAD } from '../../utils/designSystem.js';
import { formatDateOnlyHuman } from '../../utils/dateUtils.js';
import {
  FONTE_TIPO,
  FONTE_TIPO_META,
  RACCOMANDAZIONE,
  createFonte,
  nodeWorkBreakdown
} from '../../utils/sintesiEngine.js';

/**
 * V38.0 — "La Forgia degli Appunti", lato interfaccia.
 *
 * Tutta la UI dei due bilanci vive qui invece che dentro QuadrantHub.jsx:
 * l'editor delle fonti, il riepilogo di un nodo e il pannello di piano di
 * una materia. Nessuno dei tre calcola niente — leggono
 * `utils/sintesiEngine.js`, che è l'unico posto dove i numeri nascono.
 */

const TIPI_ORDINE = [FONTE_TIPO.LIBRO, FONTE_TIPO.SLIDE, FONTE_TIPO.APPUNTI_PROF, FONTE_TIPO.ALTRO];

function oreLabel(ore) {
  if (!ore) return '0h';
  return ore >= 10 ? `${Math.round(ore)}h` : `${ore}h`;
}

/* ================================================================== *
 * EDITOR DELLE FONTI DI UN NODO
 * ================================================================== */

/**
 * V39.0 — Una fonte, ridisegnata.
 *
 * Il tipo era un menu a tendina schiacciato fra due campi numerici: su
 * qualunque larghezza reale di una modale si leggeva "L.." e le opzioni
 * aperte erano "Sli...", "Ap...". Quattro opzioni corte non hanno bisogno
 * di un menu che si apre: ora sono quattro pulsanti sempre visibili, con
 * icona, che si leggono in un colpo d'occhio e si cambiano con un tocco.
 *
 * Aggiunto il nome della fonte (facoltativo): con due libri sullo stesso
 * argomento, prima si distinguevano solo dall'ordine.
 */
function FonteRow({ fonte, indice, onChange, onRemove }) {
  const baseId = useId();
  const totali = Number(fonte.pagine) || 0;
  const fatte = Math.min(Number(fonte.pagineFatte) || 0, totali);
  const pct = totali > 0 ? Math.round((fatte / totali) * 100) : 0;
  const residue = Math.max(0, totali - fatte);
  const meta = FONTE_TIPO_META[fonte.tipo] || FONTE_TIPO_META.ALTRO;

  return (
    <div className="rounded-xl border border-accent/25 bg-surface/85 p-3 space-y-3 shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
      <div className="flex items-start gap-2">
        <div
          className="flex-1 min-w-0 grid grid-cols-2 gap-1.5"
          role="radiogroup"
          aria-label={`Tipo della fonte ${indice + 1}`}
        >
          {TIPI_ORDINE.map((t) => {
            const m = FONTE_TIPO_META[t];
            const attivo = fonte.tipo === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={attivo}
                onClick={() => onChange({ tipo: t })}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors duration-200 ${
                  attivo
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200 hover:border-white/25'
                }`}
              >
                <Icon name={m.icon} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{m.short}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 w-10 h-10 -mt-1 -mr-1 flex items-center justify-center rounded-lg text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors duration-300"
          aria-label={`Rimuovi ${meta.label.toLowerCase()}${fonte.etichetta ? ` "${fonte.etichetta}"` : ''}`}
        >
          <Icon name="trash" className="w-4 h-4" />
        </button>
      </div>

      <div>
        <label htmlFor={`${baseId}-nome`} className="text-[11px] text-slate-400 block mb-1">
          Nome <span className="text-slate-500">(facoltativo)</span>
        </label>
        <input
          id={`${baseId}-nome`}
          type="text"
          maxLength={60}
          value={fonte.etichetta || ''}
          onChange={(e) => onChange({ etichetta: e.target.value })}
          placeholder={
            fonte.tipo === FONTE_TIPO.LIBRO
              ? 'Es. Bramanti – Pagani – Salsa, cap. 3'
              : fonte.tipo === FONTE_TIPO.SLIDE
              ? 'Es. Slide lezioni 4–7'
              : 'Es. Dispense della prof'
          }
          className={INPUT_SM}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label htmlFor={`${baseId}-tot`} className="text-[11px] text-slate-400 block mb-1">
            Pagine totali
          </label>
          <input
            id={`${baseId}-tot`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={totali || ''}
            onChange={(e) => {
              const nuovo = Math.max(0, Math.round(Number(e.target.value) || 0));
              // Abbassare il totale sotto le pagine già fatte le riporta al
              // nuovo totale: mai un "fatte 120 su 80".
              onChange({ pagine: nuovo, pagineFatte: Math.min(fatte, nuovo) });
            }}
            placeholder="Es. 600"
            className={`${INPUT_SM} font-mono`}
          />
        </div>
        <div>
          <label htmlFor={`${baseId}-fatte`} className="text-[11px] text-slate-400 block mb-1">
            Già snellite
          </label>
          <input
            id={`${baseId}-fatte`}
            type="number"
            inputMode="numeric"
            min={0}
            max={totali || undefined}
            step={1}
            value={fatte || ''}
            onChange={(e) =>
              onChange({ pagineFatte: Math.max(0, Math.min(totali, Math.round(Number(e.target.value) || 0))) })
            }
            placeholder="0"
            disabled={totali === 0}
            className={`${INPUT_SM} font-mono disabled:opacity-40`}
          />
        </div>
      </div>

      {totali > 0 && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-surface border border-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent to-accent/60 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="flex items-center justify-between gap-2 text-[11px] font-mono af-mono-nums">
            <span className="text-slate-400">{pct}% snellito</span>
            <span className={residue > 0 ? 'text-accent' : 'text-emerald-400'}>
              {residue > 0 ? `${residue} pagine da snellire` : 'fonte completata'}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Le fonti di un argomento e le pagine dei propri appunti, in un solo
 * blocco.
 *
 * La riga che conta davvero è quella in fondo: la proiezione. Scrivere
 * "600 pagine di libro" senza vedere in che cosa si traducono è un
 * numero che spaventa e basta; vederlo diventare "≈ 108 pagine tue,
 * ≈ 60h di sintesi + ≈ 21h di studio" è una decisione che si può
 * prendere — e a volte è la decisione di non mettere quel libro fra le
 * fonti.
 */
export function FontiEditor({
  fonti,
  onFontiChange,
  pagineAppunti,
  onPagineAppuntiChange,
  appuntiCompleti,
  onAppuntiCompletiChange,
  calibration,
  oreStimate,
  compact = false
}) {
  const lista = Array.isArray(fonti) ? fonti : [];
  const appuntiId = useId();
  const completiId = useId();

  // Nodo "finto" costruito sui valori del form: fa vedere in diretta il
  // risultato di quello che si sta scrivendo, con la stessa identica
  // funzione che userà poi il piano. Nessuna formula duplicata nella UI.
  const anteprima = useMemo(
    () =>
      nodeWorkBreakdown(
        {
          fonti: lista,
          pagineAppunti: Number(pagineAppunti) || 0,
          appuntiCompleti: !!appuntiCompleti,
          oreStimate: Number(oreStimate) || 0,
          status: 'PENDING'
        },
        calibration
      ),
    [lista, pagineAppunti, appuntiCompleti, oreStimate, calibration]
  );

  const aggiorna = (id, patch) => onFontiChange(lista.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const rimuovi = (id) => onFontiChange(lista.filter((f) => f.id !== id));
  const aggiungi = () => {
    // La seconda fonte parte come "Slide" invece che come un altro libro:
    // è di gran lunga la combinazione più comune (libro + slide del prof).
    const usati = new Set(lista.map((f) => f.tipo));
    const tipo = TIPI_ORDINE.find((t) => !usati.has(t)) || FONTE_TIPO.ALTRO;
    onFontiChange([...lista, createFonte({ tipo, pagine: 0 })]);
  };

  return (
    <div className="space-y-3.5 rounded-2xl border border-accent/25 bg-gradient-to-b from-accent/[0.07] to-accent/[0.02] p-3.5 sm:p-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-accent flex items-center gap-1.5 tracking-wide min-w-0">
            <Icon name="flask" className="w-4 h-4 shrink-0" />
            <span className="truncate">FORGIA DEGLI APPUNTI</span>
          </p>
          <button
            type="button"
            onClick={aggiungi}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/15 px-3 py-2 text-xs font-bold tracking-wide text-accent hover:bg-accent/25 transition-colors duration-300"
          >
            <Icon name="plus" className="w-3.5 h-3.5" />
            Fonte
          </button>
        </div>
        {!compact && (
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            Da cosa parti e cosa ne ricavi. Lo studio si calcola sulle pagine dei{' '}
            <span className="text-slate-200">tuoi</span> appunti; le fonti misurano il lavoro di sintesi che serve a
            ottenerle.
          </p>
        )}
      </div>

      {lista.length > 0 ? (
        <div className="space-y-2.5">
          {lista.map((f, i) => (
            <FonteRow
              key={f.id}
              fonte={f}
              indice={i}
              onChange={(patch) => aggiorna(f.id, patch)}
              onRemove={() => rimuovi(f.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400 leading-relaxed rounded-lg border border-dashed border-white/15 px-3 py-2.5">
          Nessuna fonte: il piano conterà solo lo studio. È il caso giusto quando gli appunti di questo argomento li hai
          già; altrimenti aggiungi il libro, le slide o le dispense da cui li ricaverai.
        </p>
      )}

      {/* Una colonna sola: l'editor vive sempre dentro una modale, che
          anche su desktop è larga meno di 450px — affiancati, etichetta e
          spunta andavano a capo su tre righe. */}
      <div className="space-y-3">
        <div>
          <label htmlFor={appuntiId} className="text-sm text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Icon name="note" className="w-3.5 h-3.5 text-secondary" />
            Pagine dei tuoi appunti
          </label>
          <input
            id={appuntiId}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={pagineAppunti}
            onChange={(e) => onPagineAppuntiChange(e.target.value)}
            placeholder="Es. 20"
            className={`${INPUT} font-mono`}
          />
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            Quelle già scritte. Crescono da sole a ogni sessione di sintesi.
          </p>
        </div>

        {/* La spunta ha senso solo se c'è una sintesi da chiudere: senza
            fonti non compare, invece di occupare mezzo form per niente. */}
        {lista.length > 0 && (
          <label
            htmlFor={completiId}
            className={`flex items-start gap-3 cursor-pointer rounded-xl border p-3 transition-colors duration-300 ${
              appuntiCompleti
                ? 'border-emerald-400/40 bg-emerald-500/[0.07]'
                : 'border-white/10 bg-surface/70 hover:border-secondary/40'
            }`}
          >
            <input
              id={completiId}
              type="checkbox"
              checked={!!appuntiCompleti}
              onChange={(e) => onAppuntiCompletiChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 accent-emerald-400"
            />
            <span className="min-w-0">
              <span className="text-sm font-semibold text-slate-100 block">Sintesi chiusa</span>
              <span className="text-[11px] text-slate-400 leading-relaxed block mt-0.5">
                Gli appunti di questo argomento sono finiti, anche se non hai snellito ogni pagina dichiarata.
              </span>
            </span>
          </label>
        )}
      </div>

      {(anteprima.haFonti || anteprima.pagineAppunti > 0) && (
        <div className="rounded-xl border border-secondary/25 bg-surface/80 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-slate-400">Appunti finali previsti</span>
            <span className="font-mono af-mono-nums text-slate-100">
              {anteprima.pagineAppuntiProiettate} pagine
              {anteprima.pagineAppuntiDaProdurre > 0 && (
                <span className="text-slate-500">
                  {' '}
                  ({anteprima.pagineAppunti} + {anteprima.pagineAppuntiDaProdurre})
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-slate-400">Carico di questo argomento</span>
            <span className="font-mono af-mono-nums flex items-center gap-1.5 flex-wrap">
              {anteprima.oreSintesiTotali > 0 && (
                <>
                  <span className="text-accent">{oreLabel(anteprima.oreSintesiTotali)} sintesi</span>
                  <span className="text-slate-600">+</span>
                </>
              )}
              <span className="text-secondary">{oreLabel(anteprima.oreStudioTotali)} studio</span>
              <span className="text-slate-600">=</span>
              <span className="text-slate-100 font-bold">{oreLabel(anteprima.oreTotali)}</span>
            </span>
          </div>
          {(anteprima.sintesiStimata || anteprima.proiezioneStimata || anteprima.studioStimato) && (
            <p className="text-[11px] text-slate-500 leading-relaxed pt-2 border-t border-white/5">
              Karen non ha ancora misurato{' '}
              {[
                anteprima.sintesiStimata && 'il tuo ritmo di sintesi',
                anteprima.studioStimato && 'il tuo ritmo di studio',
                anteprima.proiezioneStimata && 'quanto si restringe il materiale nelle tue mani'
              ]
                .filter(Boolean)
                .join(', ')}
              : questi numeri sono un punto di partenza prudente, non una misura, e si tarano da soli dopo qualche
              sessione.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== *
 * RIEPILOGO DI UN NODO (dettaglio in sola lettura)
 * ================================================================== */

export function NodeWorkSummary({ sfida, calibration }) {
  const b = useMemo(() => nodeWorkBreakdown(sfida, calibration), [sfida, calibration]);
  if (!b.haFonti && b.pagineAppunti === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-surface/60 p-3 space-y-2.5">
      <p className="text-xs font-semibold tracking-widest text-slate-400 flex items-center gap-1.5">
        <Icon name="flask" className="w-3.5 h-3.5 text-accent" />
        FORGIA
      </p>

      {b.haFonti && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-slate-400">Fonti snellite</span>
            <span className="font-mono af-mono-nums text-slate-200">
              {b.fontiFatte}/{b.fontiTotali}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface/90 border border-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent to-accent/60 transition-all duration-500"
              style={{ width: `${b.fontiPct}%` }}
            />
          </div>
          {b.oreSintesiResidue > 0 && (
            <p className="text-[11px] text-accent">
              {b.fontiResidue} pagine ancora da snellire · ≈ {oreLabel(b.oreSintesiResidue)}
            </p>
          )}
          {b.sintesiConclusa && (
            <p className="text-[11px] text-emerald-400 flex items-center gap-1">
              <Icon name="check" className="w-3.5 h-3.5" />
              Sintesi chiusa
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-sm pt-1 border-t border-white/5">
        <span className="text-slate-400">I tuoi appunti</span>
        <span className="font-mono af-mono-nums text-slate-200">
          {b.pagineAppunti}
          {b.pagineAppuntiDaProdurre > 0 && (
            <span className="text-slate-500"> → {b.pagineAppuntiProiettate} previste</span>
          )}{' '}
          pagine
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-400">Studio residuo</span>
        <span className="font-mono af-mono-nums text-secondary">{oreLabel(b.oreStudioResidueNette)}</span>
      </div>
    </div>
  );
}

/* ================================================================== *
 * IL PIANO DELLA MATERIA
 * ================================================================== */

const RACC_META = {
  SINTESI: {
    label: 'Oggi: SINTESI',
    tone: 'text-accent',
    border: 'border-accent/40',
    bg: 'bg-accent/10',
    icon: 'flask'
  },
  STUDIO: {
    label: 'Oggi: STUDIO',
    tone: 'text-secondary',
    border: 'border-secondary/40',
    bg: 'bg-secondary/10',
    icon: 'target'
  },
  MISTO: {
    label: 'Oggi: SINTESI + STUDIO',
    tone: 'text-cyan-300',
    border: 'border-cyan-400/40',
    bg: 'bg-cyan-500/10',
    icon: 'multiverse'
  },
  NESSUNA: { label: '', tone: 'text-slate-400', border: 'border-white/10', bg: 'bg-white/[0.03]', icon: 'radar' }
};

/**
 * Il pannello che dà il numero che nessun'altra app dà: entro quando
 * gli appunti devono essere finiti.
 */
export function PianoAppuntiPanel({ plan, materiaNome, passo = null }) {
  if (!plan || !plan.attiva) return null;
  const meta = RACC_META[plan.raccomandazione] || RACC_META.NESSUNA;
  const totaleOre = plan.oreResidue || 0;
  const pctSintesi = totaleOre > 0 ? Math.round((plan.oreSintesiResidue / totaleOre) * 100) : 0;

  return (
    <div className={CARD_NOPAD}>
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-bold tracking-widest text-slate-200 flex items-center gap-2">
          <Icon name="flask" className="w-4 h-4 text-accent" />
          PIANO APPUNTI
        </p>
        {plan.raccomandazione !== RACCOMANDAZIONE.NESSUNA && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-mono ${meta.border} ${meta.bg} ${meta.tone}`}
          >
            <Icon name={meta.icon} className="w-3.5 h-3.5" />
            {meta.label}
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {plan.motivo && <p className="text-sm text-slate-300 leading-relaxed">{plan.motivo}</p>}

        {/* La scadenza vera. */}
        {plan.dataChiusuraAppunti && (
          <div
            className={`rounded-xl border p-3 ${
              plan.inRitardo ? 'border-primary/50 bg-primary/10' : 'border-accent/30 bg-accent/[0.06]'
            }`}
          >
            <p className="text-[11px] tracking-widest text-slate-400 mb-1">APPUNTI DA CHIUDERE ENTRO</p>
            <p
              className={`text-xl font-mono af-mono-nums font-bold ${
                plan.inRitardo ? 'text-primary' : 'text-accent'
              }`}
            >
              {formatDateOnlyHuman(plan.dataChiusuraAppunti)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              {plan.inRitardo ? (
                <>
                  Scadenza superata di {Math.abs(plan.giorniAllaChiusura)} giorni. Da qui in poi ogni giorno speso a
                  snellire è un giorno tolto allo studio.
                </>
              ) : (
                <>
                  Fra {plan.giorniAllaChiusura} giorni. Non è la data d'esame: è il giorno oltre il quale non
                  resterebbe abbastanza tempo per studiare quello che stai scrivendo ({plan.giorniPerStudio} giorni di
                  studio previsti).
                </>
              )}
            </p>
          </div>
        )}

        {/* V39.0 — Empire State University: se la materia è in orario
            nel semestre in corso, il ritmo che conta durante le lezioni è
            quello settimanale — la sintesi dovuta per le lezioni già
            fatte, non una quota spalmata fino all'esame. */}
        {passo && passo.dovutoMin > 0 && (
          <div
            className={`rounded-xl border p-3 ${
              passo.stato === 'INDIETRO'
                ? 'border-primary/40 bg-primary/[0.07]'
                : passo.stato === 'QUASI'
                ? 'border-accent/40 bg-accent/[0.06]'
                : 'border-emerald-400/30 bg-emerald-500/[0.05]'
            }`}
          >
            <p className="text-[11px] tracking-widest text-slate-400 mb-1 flex items-center gap-1.5">
              <Icon name="calendar" className="w-3.5 h-3.5 text-cyan-300" />
              STARE AL PASSO CON LE LEZIONI
            </p>
            <p className="text-sm text-slate-200">
              Sintesi di questa settimana:{' '}
              <span className="font-mono af-mono-nums">{oreLabel(Math.round((passo.sintesiFattaMin / 60) * 10) / 10)}</span> su{' '}
              <span className="font-mono af-mono-nums">{oreLabel(Math.round((passo.dovutoMin / 60) * 10) / 10)}</span> dovute per
              le lezioni già fatte
              {passo.mancanoMin > 0 && (
                <span className="text-slate-400">
                  {' '}
                  — mancano {oreLabel(Math.round((passo.mancanoMin / 60) * 10) / 10)}
                </span>
              )}
              .
            </p>
          </div>
        )}

        {/* Quota di oggi. */}
        {plan.quotaSintesiOggi > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-slate-400">Da snellire oggi</span>
            <span className="font-mono af-mono-nums text-lg text-accent">{plan.quotaSintesiOggi} pagine</span>
          </div>
        )}

        {/* I due bilanci, uno accanto all'altro. */}
        <div className="space-y-2">
          <div className="flex h-2.5 rounded-full overflow-hidden border border-white/10 bg-surface/90">
            {plan.oreSintesiResidue > 0 && (
              <div className="h-full bg-gradient-to-r from-accent to-accent/60" style={{ width: `${pctSintesi}%` }} />
            )}
            {plan.oreStudioResidue > 0 && (
              <div
                className="h-full bg-gradient-to-r from-secondary to-secondary-dark"
                style={{ width: `${100 - pctSintesi}%` }}
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs font-mono flex-wrap">
            <span className="text-accent">
              {oreLabel(plan.oreSintesiResidue)} di sintesi
              {plan.fontiResidue > 0 && <span className="text-slate-500"> · {plan.fontiResidue} pagine</span>}
            </span>
            <span className="text-secondary">{oreLabel(plan.oreStudioResidue)} di studio</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
          <div>
            <p className="text-[11px] tracking-wide text-slate-500">FONTI</p>
            <p className="font-mono af-mono-nums text-sm text-slate-200">
              {plan.fontiFatte}/{plan.fontiTotali} <span className="text-slate-500">({plan.fontiPct}%)</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] tracking-wide text-slate-500">APPUNTI FINALI</p>
            <p className="font-mono af-mono-nums text-sm text-slate-200">
              {plan.pagineAppuntiProiettate} <span className="text-slate-500">pagine previste</span>
            </p>
          </div>
        </div>

        {plan.stimato && (
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Stima non ancora calibrata su di te: servono qualche sessione di sintesi e qualche argomento chiuso perché
            Karen misuri il tuo ritmo reale e quanto si restringe il materiale nelle tue mani. Fino ad allora questi
            numeri sono un punto di partenza dichiarato.
          </p>
        )}

        {materiaNome && (
          <p className="sr-only">
            Piano appunti di {materiaNome}: {plan.motivo}
          </p>
        )}
      </div>
    </div>
  );
}
