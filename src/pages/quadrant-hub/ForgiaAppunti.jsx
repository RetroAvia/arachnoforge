import React, { useId, useMemo } from 'react';
import { Icon } from '../../components/Icons.jsx';
import { INPUT, INPUT_SM, CARD_NOPAD } from '../../utils/designSystem.js';
import { formatDateOnlyHuman } from '../../utils/dateUtils.js';
import { pagineLabel, oreLabel } from '../../utils/format.js';
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
    <div className="rounded-lg border border-line bg-panel p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div
          className="ds-segmented flex-1 min-w-0 !grid grid-cols-4"
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
                title={m.label}
                onClick={() => onChange({ tipo: t })}
                className="justify-center !px-1.5 min-w-0"
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
          className="ds-icon-btn shrink-0 hover:!text-primary"
          aria-label={`Rimuovi ${meta.label.toLowerCase()}${fonte.etichetta ? ` "${fonte.etichetta}"` : ''}`}
          title="Rimuovi fonte"
        >
          <Icon name="trash" className="w-4 h-4" />
        </button>
      </div>

      <div>
        <label htmlFor={`${baseId}-nome`} className="ds-label !text-xs">
          Nome <span className="text-slate-500 font-normal">(facoltativo)</span>
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
          <label htmlFor={`${baseId}-tot`} className="ds-label !text-xs">
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
            className={`${INPUT_SM} ds-num`}
          />
        </div>
        <div>
          <label htmlFor={`${baseId}-fatte`} className="ds-label !text-xs">
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
            className={`${INPUT_SM} ds-num`}
          />
        </div>
      </div>

      {totali > 0 && (
        <div className="space-y-1.5">
          <div className="ds-progress">
            <span className="bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="flex items-center justify-between gap-2 text-[11px] ds-num">
            <span className="text-slate-400">{pct}% snellito</span>
            <span className={residue > 0 ? 'text-accent' : 'text-emerald-300'}>
              {residue > 0 ? `${pagineLabel(residue)} da snellire` : 'Fonte completata'}
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
  compact = false,
  pagineAppuntiPreviste = '',
  onPagineAppuntiPrevisteChange = null
}) {
  const lista = useMemo(() => (Array.isArray(fonti) ? fonti : []), [fonti]);
  const appuntiId = useId();
  const completiId = useId();
  const previsteId = useId();

  // Nodo "finto" costruito sui valori del form: fa vedere in diretta il
  // risultato di quello che si sta scrivendo, con la stessa identica
  // funzione che userà poi il piano. Nessuna formula duplicata nella UI.
  const anteprima = useMemo(
    () =>
      nodeWorkBreakdown(
        {
          fonti: lista,
          pagineAppunti: Number(pagineAppunti) || 0,
          pagineAppuntiPreviste: Number(pagineAppuntiPreviste) || 0,
          appuntiCompleti: !!appuntiCompleti,
          oreStimate: Number(oreStimate) || 0,
          status: 'PENDING'
        },
        calibration
      ),
    [lista, pagineAppunti, pagineAppuntiPreviste, appuntiCompleti, oreStimate, calibration]
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
    <div className="space-y-3.5 rounded-xl border border-line bg-surface/60 p-3.5 sm:p-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-100 flex items-center gap-2 min-w-0">
            <Icon name="flask" className="w-4 h-4 shrink-0 text-accent" />
            <span className="truncate">Forgia degli Appunti</span>
          </p>
          <button type="button" onClick={aggiungi} className="ds-btn ds-btn-ghost ds-btn-sm shrink-0">
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

      {/* Una colonna sola: l'editor vive sempre dentro una modale. */}
      <div className="space-y-3">
        <div>
          <label htmlFor={appuntiId} className="ds-label flex items-center gap-1.5">
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
            className={`${INPUT} ds-num`}
          />
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            Quelle già scritte. Crescono da sole a ogni sessione di sintesi.
          </p>
        </div>

        {/* V42 — quante pagine verranno i tuoi appunti, se lo sai già
            (es. 300 slide e 1000 pagine di libro -> 35 pagine tue). */}
        {lista.length > 0 && onPagineAppuntiPrevisteChange && (
          <div>
            <label htmlFor={previsteId} className="ds-label flex items-center gap-1.5">
              <Icon name="target" className="w-3.5 h-3.5 text-secondary" />
              Pagine di appunti previste <span className="text-slate-500 font-normal">(facoltativo)</span>
            </label>
            <input
              id={previsteId}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={pagineAppuntiPreviste}
              onChange={(e) => onPagineAppuntiPrevisteChange(e.target.value)}
              placeholder="Es. 35"
              className={`${INPUT} ds-num`}
            />
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
              Se sai già quanto verranno lunghi i tuoi appunti finali, scrivilo: il piano userà questo numero invece della resa stimata.
            </p>
          </div>
        )}

        {/* La spunta ha senso solo se c'è una sintesi da chiudere. */}
        {lista.length > 0 && (
          <label
            htmlFor={completiId}
            className={`flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-colors duration-150 ${
              appuntiCompleti ? 'border-emerald-400/35 bg-emerald-500/[0.06]' : 'border-line bg-panel hover:border-line-strong'
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
        <div className="rounded-lg border border-line bg-panel p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-slate-400">Appunti finali previsti</span>
            <span className="ds-num text-slate-100 font-medium">
              {pagineLabel(anteprima.pagineAppuntiProiettate)}
              {anteprima.pagineAppuntiDaProdurre > 0 && (
                <span className="text-slate-500 font-normal">
                  {' '}
                  ({anteprima.pagineAppunti} + {anteprima.pagineAppuntiDaProdurre})
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-slate-400">Carico di questo argomento</span>
            <span className="ds-num flex items-center gap-1.5 flex-wrap">
              {anteprima.oreSintesiTotali > 0 && (
                <>
                  <span className="text-accent">{oreLabel(anteprima.oreSintesiTotali)} sintesi</span>
                  <span className="text-slate-600">+</span>
                </>
              )}
              <span className="text-secondary">{oreLabel(anteprima.oreStudioTotali)} studio</span>
              <span className="text-slate-600">=</span>
              <span className="text-slate-100 font-semibold">{oreLabel(anteprima.oreTotali)}</span>
            </span>
          </div>
          {(anteprima.sintesiStimata || anteprima.proiezioneStimata || anteprima.studioStimato) && (
            <p className="text-[11px] text-slate-500 leading-relaxed pt-2 border-t border-line">
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
    <div className="rounded-xl border border-line bg-surface/70 p-3.5 space-y-2.5">
      <p className="ds-eyebrow flex items-center gap-1.5">
        <Icon name="flask" className="w-3.5 h-3.5 text-accent" />
        Forgia degli Appunti
      </p>

      {b.haFonti && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-slate-400">Fonti snellite</span>
            <span className="ds-num text-slate-200">
              {b.fontiFatte}/{b.fontiTotali}
            </span>
          </div>
          <div className="ds-progress">
            <span className="bg-accent" style={{ width: `${b.fontiPct}%` }} />
          </div>
          {b.oreSintesiResidue > 0 && (
            <p className="text-[11px] text-accent ds-num">
              {pagineLabel(b.fontiResidue)} ancora da snellire · ≈ {oreLabel(b.oreSintesiResidue)}
            </p>
          )}
          {b.sintesiConclusa && (
            <p className="text-[11px] text-emerald-300 flex items-center gap-1">
              <Icon name="check" className="w-3.5 h-3.5" />
              Sintesi chiusa
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-sm pt-2 border-t border-line">
        <span className="text-slate-400">I tuoi appunti</span>
        <span className="ds-num text-slate-200">
          {b.pagineAppuntiDaProdurre > 0 ? (
            <>
              {b.pagineAppunti} <span className="text-slate-500">→ {pagineLabel(b.pagineAppuntiProiettate)} previste</span>
            </>
          ) : (
            pagineLabel(b.pagineAppunti)
          )}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-400">Studio residuo</span>
        <span className="ds-num text-secondary">{oreLabel(b.oreStudioResidueNette)}</span>
      </div>
    </div>
  );
}

/* ================================================================== *
 * IL PIANO DELLA MATERIA
 * ================================================================== */

const RACC_META = {
  SINTESI: { label: 'Oggi: sintesi', badge: 'ds-badge ds-badge-amber', icon: 'flask' },
  STUDIO: { label: 'Oggi: studio', badge: 'ds-badge ds-badge-blue', icon: 'target' },
  MISTO: { label: 'Oggi: sintesi + studio', badge: 'ds-badge ds-badge-cyan', icon: 'multiverse' },
  NESSUNA: { label: '', badge: 'ds-badge ds-badge-slate', icon: 'radar' }
};

const PASSO_TONE = {
  INDIETRO: { well: 'border-primary/35 bg-primary/[0.06]', text: 'text-primary', label: 'Indietro' },
  QUASI: { well: 'border-accent/35 bg-accent/[0.05]', text: 'text-accent', label: 'Quasi al passo' },
  IN_PARI: { well: 'border-emerald-400/30 bg-emerald-500/[0.05]', text: 'text-emerald-300', label: 'Al passo' }
};

const giorniLabel = (n) => `${n} ${n === 1 ? 'giorno' : 'giorni'}`;

/**
 * Spiegazione della scadenza degli appunti. V41 — `inRitardo` vale sia
 * per una scadenza già superata sia per una sintesi che "non ci sta" nei
 * giorni rimasti: prima entrambi i casi dicevano "scadenza superata",
 * anche con la data ancora nel futuro.
 */
function deadlineText(plan) {
  const g = plan.giorniAllaChiusura;
  if (g != null && g < 0) {
    return `Scadenza superata di ${giorniLabel(Math.abs(g))}: da qui ogni giorno speso a snellire è tolto allo studio.`;
  }
  if (g === 0) return 'La scadenza è oggi: da domani ogni giorno speso a snellire è tolto allo studio.';
  if (plan.inRitardo) {
    return `Fra ${giorniLabel(g)}: troppo pochi per la sintesi che resta. È l'ultimo giorno utile per lasciare ${giorniLabel(plan.giorniPerStudio)} di studio.`;
  }
  return `Fra ${giorniLabel(g)}. Non è la data d'esame: è l'ultimo giorno utile per lasciare ${giorniLabel(plan.giorniPerStudio)} di studio su quello che stai scrivendo.`;
}

/**
 * Il pannello che dà il numero che nessun'altra app dà: entro quando
 * gli appunti devono essere finiti per fare in tempo a studiarli.
 */
export function PianoAppuntiPanel({ plan, materiaNome, passo = null }) {
  if (!plan || !plan.attiva) return null;
  const meta = RACC_META[plan.raccomandazione] || RACC_META.NESSUNA;
  const totaleOre = plan.oreResidue || 0;
  const pctSintesi = totaleOre > 0 ? Math.round((plan.oreSintesiResidue / totaleOre) * 100) : 0;
  const passoTone = passo ? PASSO_TONE[passo.stato] || PASSO_TONE.IN_PARI : null;
  const showPasso = passo && passo.dovutoMin > 0;

  return (
    <section className={CARD_NOPAD} aria-label={materiaNome ? `Piano appunti di ${materiaNome}` : 'Piano appunti'}>
      <div className="px-4 sm:px-5 py-3.5 border-b border-line flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon name="flask" className="w-4 h-4 text-accent shrink-0" />
          <h3 className="text-[15px] font-semibold text-white">Piano appunti</h3>
        </div>
        {plan.raccomandazione !== RACCOMANDAZIONE.NESSUNA && (
          <span className={meta.badge}>
            <Icon name={meta.icon} className="w-3 h-3" />
            {meta.label}
          </span>
        )}
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {plan.motivo && <p className="text-sm text-slate-300 leading-relaxed">{plan.motivo}</p>}

        {(plan.dataChiusuraAppunti || showPasso) && (
          <div className={`grid gap-3 ${plan.dataChiusuraAppunti && showPasso ? 'md:grid-cols-2' : ''}`}>
            {/* La scadenza vera. */}
            {plan.dataChiusuraAppunti && (
              <div
                className={`rounded-xl border p-3.5 ${
                  plan.inRitardo ? 'border-primary/40 bg-primary/[0.07]' : 'border-line bg-surface/70'
                }`}
              >
                <p className="ds-eyebrow">Appunti da chiudere entro</p>
                <p className={`mt-1 text-xl font-bold ds-num ${plan.inRitardo ? 'text-primary' : 'text-accent'}`}>
                  {formatDateOnlyHuman(plan.dataChiusuraAppunti)}
                </p>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{deadlineText(plan)}</p>
              </div>
            )}

            {/* V39.0 — durante il semestre conta il ritmo settimanale: la
                sintesi dovuta per le lezioni già fatte. */}
            {showPasso && (
              <div className={`rounded-xl border p-3.5 ${passoTone.well}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="ds-eyebrow flex items-center gap-1.5">
                    <Icon name="calendar" className="w-3.5 h-3.5 text-cyan-300" />
                    Al passo con le lezioni
                  </p>
                  <span className={`text-xs font-semibold ${passoTone.text}`}>{passoTone.label}</span>
                </div>
                <p className="mt-1.5 text-sm text-slate-200 ds-num">
                  {oreLabel(passo.sintesiFattaMin / 60)} <span className="text-slate-500">su</span>{' '}
                  {oreLabel(passo.dovutoMin / 60)}
                </p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Sintesi di questa settimana per le lezioni già fatte
                  {passo.mancanoMin > 0 ? ` — ne mancano ${oreLabel(passo.mancanoMin / 60)}.` : '.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* I due bilanci sulla stessa barra. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs ds-num flex-wrap">
            <span className="text-accent font-medium">
              {oreLabel(plan.oreSintesiResidue)} di sintesi
              {plan.fontiResidue > 0 && <span className="text-slate-500 font-normal"> · {pagineLabel(plan.fontiResidue)}</span>}
            </span>
            <span className="text-secondary font-medium">{oreLabel(plan.oreStudioResidue)} di studio</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.07] gap-px">
            {plan.oreSintesiResidue > 0 && <div className="h-full bg-accent" style={{ width: `${pctSintesi}%` }} />}
            {plan.oreStudioResidue > 0 && <div className="h-full bg-secondary" style={{ width: `${100 - pctSintesi}%` }} />}
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-line">
          <div>
            <dt className="text-[11px] text-slate-500">Fonti snellite</dt>
            <dd className="ds-num text-sm text-slate-100 mt-0.5">
              {plan.fontiFatte}/{plan.fontiTotali} <span className="text-slate-500">· {plan.fontiPct}%</span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Appunti finali previsti</dt>
            <dd className="ds-num text-sm text-slate-100 mt-0.5">{pagineLabel(plan.pagineAppuntiProiettate)}</dd>
          </div>
          {plan.quotaSintesiOggi > 0 && (
            <div>
              <dt className="text-[11px] text-slate-500">Da snellire oggi</dt>
              <dd className="ds-num text-sm font-semibold text-accent mt-0.5">{pagineLabel(plan.quotaSintesiOggi)}</dd>
            </div>
          )}
        </dl>

        {plan.stimato && (
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Stima non ancora calibrata su di te: dopo qualche sessione di sintesi e qualche argomento chiuso Karen misura
            il tuo ritmo reale e quanto si restringe il materiale nelle tue mani. Fino ad allora è un punto di partenza
            dichiarato.
          </p>
        )}
      </div>
    </section>
  );
}
