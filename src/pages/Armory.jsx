import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Drawer from '../components/Drawer.jsx';
import PageHeader from '../components/PageHeader.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { NODE_STATUS, deriveNodeStatus } from '../utils/skillTree.js';
import { formatDateHuman } from '../utils/dateUtils.js';
import { TIER, TIER_META } from '../data/trophies.js';
import { SKILL_DEFS, SKILL_PATH, SKILL_PATH_META, SKILL_TIER_ORDER, canUnlockSkill } from '../data/techTree.js';
import { CARD, CARD_NOPAD, BTN_SECONDARY, BTN_AMBER, BTN_GHOST, INPUT, LABEL, BADGE } from '../utils/designSystem.js';
import { formatInt } from '../utils/format.js';

// =====================================================================
// Suit Lab & Trophies — dove l'XP guadagnato studiando diventa qualcosa:
// ricompense vere (Reward Shop), abilità passive (Skill Tree), trofei.
// Più i Blueprint: il formulario di ogni argomento completato.
//
// V41 — quattro schede invece di una pagina unica lunghissima, una
// riga di riepilogo sempre visibile (che porta alla scheda giusta), e
// nessun effetto "vetro/alone": gli stati si leggono da colore e testo.
// =====================================================================

// V35.0 — 4 tier di trofei (data/trophies.js) e 5 tier per corsia di
// abilità (SKILL_TIER_ORDER in data/techTree.js, unica fonte di verità).
const TIER_ORDER = [TIER.NEIGHBORHOOD, TIER.AVENGER, TIER.MULTIVERSE, TIER.VIBRANIUM];
const DRAWER_TRANSITION_MS = 300;
const PATH_ORDER = [SKILL_PATH.DEFENSE, SKILL_PATH.EFFICIENCY, SKILL_PATH.AGGRESSION];

const TAB_STORAGE_KEY = 'arachnoforge_armory_tab';
const ARMORY_TABS = [
  { id: 'shop', label: 'Shop e inventario', icon: 'target' },
  { id: 'skilltree', label: 'Skill Tree', icon: 'chip' },
  { id: 'trofei', label: 'Trofei', icon: 'trophy' },
  { id: 'blueprints', label: 'Blueprints', icon: 'book' }
];

function readSavedTab() {
  try {
    const v = window.localStorage.getItem(TAB_STORAGE_KEY);
    return ARMORY_TABS.some((t) => t.id === v) ? v : 'shop';
  } catch {
    return 'shop';
  }
}

/** Colore della barra di avanzamento di ogni tier di trofei (classi statiche). */
const TIER_BAR = { NEIGHBORHOOD: 'bg-zinc-400', AVENGER: 'bg-secondary', MULTIVERSE: 'bg-primary', VIBRANIUM: 'bg-violet-400' };

/** Accento a sinistra delle card abilità, per corsia (classi statiche). */
const PATH_BAR = { DEFENSE: 'bg-secondary', EFFICIENCY: 'bg-accent', AGGRESSION: 'bg-primary' };

/**
 * Card di un'abilità dello Skill Tree — quattro stati: attiva,
 * sbloccabile ora (Token sufficienti e prerequisiti ok), bloccata dai
 * prerequisiti, bloccata solo dai Token.
 */
function SkillCard({ skill, unlocked, unlockable, prereqMissing, techTokens, onUnlockClick }) {
  const meta = SKILL_PATH_META[skill.path];
  const lockedByTokensOnly = !unlocked && !prereqMissing && techTokens < skill.cost;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-3.5 transition-colors duration-150 ${
        unlocked
          ? 'border-line-strong bg-panel-2'
          : unlockable
          ? 'border-accent/45 bg-accent/[0.05]'
          : prereqMissing
          ? 'border-line bg-surface/60 opacity-50'
          : 'border-line bg-surface/80'
      }`}
    >
      {unlocked && <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${PATH_BAR[skill.path]}`} aria-hidden="true" />}
      <div className="flex items-start justify-between gap-2">
        <span
          className={`w-9 h-9 rounded-lg flex items-center justify-center border shrink-0 ${
            unlocked ? `border-line-strong bg-panel-3 ${meta.color}` : 'border-line bg-panel text-slate-500'
          }`}
        >
          <Icon name={skill.icon} className="w-[18px] h-[18px]" />
        </span>
        {unlocked ? (
          <span className={BADGE.green}>
            <Icon name="check" className="w-3 h-3" />
            Attiva
          </span>
        ) : (
          <span className={unlockable ? BADGE.amber : BADGE.slate}>
            <Icon name="chip" className="w-3 h-3" />
            {skill.cost} {skill.cost === 1 ? 'token' : 'token'}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-100 mt-2.5 leading-snug">{skill.title}</p>
      <p className={`text-xs mt-0.5 font-medium ${unlocked ? meta.color : 'text-slate-400'}`}>{skill.tagline}</p>
      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{skill.description}</p>
      {!unlocked && (
        <button
          type="button"
          disabled={!unlockable}
          onClick={() => onUnlockClick(skill)}
          title={prereqMissing ? 'Sblocca prima l’abilità precedente della corsia' : lockedByTokensOnly ? 'Tech Token insufficienti' : ''}
          className={`w-full mt-3 ds-btn ds-btn-sm ${unlockable ? 'ds-btn-amber' : 'ds-btn-ghost'}`}
        >
          {prereqMissing ? (
            <>
              <Icon name="lock" className="w-3.5 h-3.5" />
              Richiede l'abilità precedente
            </>
          ) : lockedByTokensOnly ? (
            <>
              <Icon name="chip" className="w-3.5 h-3.5" />
              Mancano {skill.cost - techTokens} token
            </>
          ) : (
            <>
              <Icon name="bolt" className="w-3.5 h-3.5" />
              Sblocca
            </>
          )}
        </button>
      )}
    </div>
  );
}

/** Connettore verticale fra due tier della stessa corsia: si accende quando il nodo sopra è sbloccato. */
function TierConnector({ active }) {
  return (
    <div className="flex items-center justify-center h-5" aria-hidden="true">
      <div className={`w-px h-full transition-colors duration-500 ${active ? 'bg-accent/70' : 'bg-white/10'}`} />
    </div>
  );
}

/** Riepilogo in testa alla pagina: ogni riquadro porta alla sua scheda. */
function SummaryTile({ icon, iconTone, label, value, hint, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-[var(--af-radius-card)] border px-4 py-3.5 transition-colors ${
        active ? 'border-line-strong bg-panel-2' : 'border-line bg-panel hover:border-line-strong'
      }`}
    >
      <p className="text-xs text-slate-400 flex items-center gap-1.5">
        <Icon name={icon} className={`w-3.5 h-3.5 ${iconTone}`} />
        {label}
      </p>
      <p className="mt-1.5 text-xl font-bold text-white ds-num">{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{hint}</p>}
    </button>
  );
}

export default function Armory() {
  const { state, actions, derived } = useArachnoForge();
  const [activeTab, setActiveTabState] = useState(readSavedTab);
  const setActiveTab = (id) => {
    setActiveTabState(id);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, id);
    } catch {
      /* preferenza solo locale: se non si può salvare, pazienza */
    }
  };
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [rewardNome, setRewardNome] = useState('');
  const [rewardCosto, setRewardCosto] = useState('500');
  const [deleteRewardTarget, setDeleteRewardTarget] = useState(null);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [consumeTarget, setConsumeTarget] = useState(null);
  const [unlockTarget, setUnlockTarget] = useState(null);
  const [blueprintQuery, setBlueprintQuery] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerData, setDrawerData] = useState(null); // { materiaId, materiaNome, sfida }
  const [drawerText, setDrawerText] = useState('');
  const saveTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);

  const techTokens = state.profile.techTokens || 0;
  const unlockedSkills = useMemo(
    () => (Array.isArray(state.profile.unlockedSkills) ? state.profile.unlockedSkills : []),
    [state.profile.unlockedSkills]
  );
  const shopRewards = Array.isArray(state.shopRewards) ? state.shopRewards : [];
  const inventory = Array.isArray(state.inventory) ? state.inventory : [];
  const bankedXp = derived.totalBankedXp;

  const blueprintNodes = useMemo(() => {
    const list = [];
    (Array.isArray(state.materie) ? state.materie : []).forEach((m) => {
      const sfide = Array.isArray(m?.sfide) ? m.sfide : [];
      sfide.forEach((s) => {
        if (!s) return;
        const status = deriveNodeStatus(s, sfide);
        if (status === NODE_STATUS.COMPLETED || status === NODE_STATUS.NEEDS_REVIEW) {
          list.push({ materiaId: m.id, materiaNome: m.nome, sfida: s });
        }
      });
    });
    return list;
  }, [state.materie]);

  // V41 — Blueprint raggruppati per materia, con ricerca: con cento
  // argomenti completati la griglia piatta di prima era ingestibile.
  const blueprintGroups = useMemo(() => {
    const q = blueprintQuery.trim().toLowerCase();
    const byMateria = new Map();
    blueprintNodes.forEach((entry) => {
      if (q && !entry.sfida.nome.toLowerCase().includes(q) && !entry.materiaNome.toLowerCase().includes(q)) return;
      if (!byMateria.has(entry.materiaId)) byMateria.set(entry.materiaId, { materiaId: entry.materiaId, materiaNome: entry.materiaNome, items: [] });
      byMateria.get(entry.materiaId).items.push(entry);
    });
    return Array.from(byMateria.values()).map((g) => ({
      ...g,
      // Prima quelli già scritti: sono quelli che si riaprono.
      items: [...g.items].sort((a, b) => Number(!!b.sfida.blueprint) - Number(!!a.sfida.blueprint)),
      scritti: g.items.filter((e) => !!e.sfida.blueprint).length
    }));
  }, [blueprintNodes, blueprintQuery]);
  const blueprintScritti = blueprintNodes.filter((e) => !!e.sfida.blueprint).length;

  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const pendingSaveRef = useRef(null);
  useEffect(
    () => () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      const pending = pendingSaveRef.current;
      if (pending) actionsRef.current.updateSfida(pending.materiaId, pending.sfidaId, { blueprint: pending.value });
    },
    []
  );

  const openDrawer = (entry) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setDrawerData(entry);
    setDrawerText(entry.sfida.blueprint || '');
    setDrawerOpen(true);
  };

  // V39 — la bozza in attesa (debounce 400 ms) viene salvata subito alla
  // chiusura: prima si perdevano le ultime parole scritte.
  const flushPendingSave = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) actions.updateSfida(pending.materiaId, pending.sfidaId, { blueprint: pending.value });
  };

  const closeDrawer = () => {
    flushPendingSave();
    setDrawerOpen(false);
    closeTimeoutRef.current = setTimeout(() => setDrawerData(null), DRAWER_TRANSITION_MS);
  };

  const handleDrawerTextChange = (value) => {
    setDrawerText(value);
    if (!drawerData) return;
    pendingSaveRef.current = { materiaId: drawerData.materiaId, sfidaId: drawerData.sfida.id, value };
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(flushPendingSave, 400);
  };

  const trophiesByTier = useMemo(() => {
    // V39 — i gruppi nascono da TIER_ORDER (il Vibranium mancava).
    const grouped = Object.fromEntries(TIER_ORDER.map((t) => [t, []]));
    derived.trophyList.forEach((t) => {
      if (grouped[t.tier]) grouped[t.tier].push(t);
    });
    return grouped;
  }, [derived.trophyList]);
  const trophiesUnlocked = derived.trophyList.filter((t) => t.unlocked).length;
  const lastTrophy = useMemo(
    () =>
      derived.trophyList
        .filter((t) => t.unlocked && t.unlockedAt)
        .sort((a, b) => String(b.unlockedAt).localeCompare(String(a.unlockedAt)))[0] || null,
    [derived.trophyList]
  );
  const inventoryCount = inventory.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

  const costoNum = Math.round(Number(rewardCosto));
  const rewardValida = rewardNome.trim().length > 0 && Number.isFinite(costoNum) && costoNum >= 1;

  const onTabsKeyDown = (e) => {
    // V39 — pattern WAI-ARIA Tabs: frecce, Home, End.
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const ids = ARMORY_TABS.map((t) => t.id);
    const i = ids.indexOf(activeTab);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else next = ids.length - 1;
    setActiveTab(ids[next]);
    requestAnimationFrame(() => document.getElementById(`armory-tab-${ids[next]}`)?.focus());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ricompense e progressi"
        icon="flask"
        title="Suit Lab & Trophies"
        subtitle="L'XP che guadagni studiando diventa ricompense vere, abilità permanenti e trofei."
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <SummaryTile
          icon="target"
          iconTone="text-accent"
          label="XP disponibili"
          value={formatInt(bankedXp)}
          hint={inventoryCount > 0 ? `${inventoryCount} ${inventoryCount === 1 ? 'ricompensa' : 'ricompense'} in inventario` : 'da spendere nello Shop'}
          active={activeTab === 'shop'}
          onClick={() => setActiveTab('shop')}
        />
        <SummaryTile
          icon="chip"
          iconTone="text-accent"
          label="Tech Token"
          value={formatInt(techTokens)}
          hint={`${unlockedSkills.length} ${unlockedSkills.length === 1 ? 'abilità attiva' : 'abilità attive'} su ${SKILL_DEFS.length}`}
          active={activeTab === 'skilltree'}
          onClick={() => setActiveTab('skilltree')}
        />
        <SummaryTile
          icon="trophy"
          iconTone="text-amber-300"
          label="Trofei"
          value={`${trophiesUnlocked} / ${derived.trophyList.length}`}
          hint={lastTrophy ? `ultimo: ${lastTrophy.nome}` : 'nessuno ancora'}
          active={activeTab === 'trofei'}
          onClick={() => setActiveTab('trofei')}
        />
        <SummaryTile
          icon="book"
          iconTone="text-secondary"
          label="Blueprints"
          value={`${blueprintScritti} / ${blueprintNodes.length}`}
          hint="formulari scritti sugli argomenti chiusi"
          active={activeTab === 'blueprints'}
          onClick={() => setActiveTab('blueprints')}
        />
      </div>

      <div className="flex items-center gap-1 border-b border-line overflow-x-auto af-scroll" role="tablist" aria-label="Sezioni della Suit Lab" onKeyDown={onTabsKeyDown}>
        {ARMORY_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`armory-tab-${tab.id}`}
              role="tab"
              aria-selected={active}
              aria-controls={`armory-tabpanel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px shrink-0 whitespace-nowrap ${
                active ? 'text-white border-primary' : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              <Icon name={tab.icon} className={`w-4 h-4 ${active ? 'text-primary' : ''}`} />
              {tab.label}
              {tab.id === 'skilltree' && techTokens > 0 && <span className="w-1.5 h-1.5 rounded-full bg-accent" title="Hai Tech Token da spendere" />}
            </button>
          );
        })}
      </div>

      {/* ---------------- SHOP E INVENTARIO ---------------- */}
      {activeTab === 'shop' && (
        <div role="tabpanel" id="armory-tabpanel-shop" aria-labelledby="armory-tab-shop" className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          <section className="xl:col-span-2 space-y-3" aria-label="Reward Shop">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h2 className="ds-h2">Reward Shop</h2>
                <p className="text-[13px] text-slate-500 mt-0.5">Ricompense vere che ti concedi con l'XP guadagnato: studi, poi te le prendi.</p>
              </div>
              <button type="button" onClick={() => setRewardModalOpen(true)} className={`${BTN_SECONDARY} ds-btn-sm`}>
                <Icon name="plus" className="w-3.5 h-3.5" />
                Nuova ricompensa
              </button>
            </div>
            {shopRewards.length === 0 ? (
              <div className={CARD}>
                <EmptyState
                  variant="safe"
                  compact
                  title="Nessuna ricompensa ancora"
                  subtitle="Aggiungi le cose che ti motivano (una serata fuori, un episodio, un dolce): costeranno XP per essere riscattate."
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {shopRewards.map((r) => {
                  const affordable = bankedXp >= r.costoXp;
                  const pct = r.costoXp > 0 ? Math.min(100, Math.round((bankedXp / r.costoXp) * 100)) : 100;
                  return (
                    <div key={r.id} className={`${CARD_NOPAD} p-4 flex flex-col gap-3`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium leading-snug text-slate-100 break-words">{r.nome}</p>
                          <p className="text-sm ds-num text-accent mt-0.5 font-semibold">{formatInt(r.costoXp)} XP</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeleteRewardTarget(r)}
                          className="ds-icon-btn !w-8 !h-8 shrink-0 hover:!text-primary"
                          aria-label={`Elimina ${r.nome}`}
                          title="Elimina ricompensa"
                        >
                          <Icon name="trash" className="w-4 h-4" />
                        </button>
                      </div>
                      {affordable ? (
                        <button type="button" onClick={() => setRedeemTarget(r)} className={`${BTN_AMBER} ds-btn-sm w-full`}>
                          <Icon name="target" className="w-3.5 h-3.5" />
                          Riscatta
                        </button>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="ds-progress">
                            <span className="bg-accent/70" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[11px] text-slate-500 ds-num">Mancano {formatInt(r.costoXp - bankedXp)} XP · sei al {pct}%</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3" aria-label="Inventario">
            <div>
              <h2 className="ds-h2">Inventario</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">Le ricompense riscattate, pronte quando vuoi.</p>
            </div>
            <div className={CARD_NOPAD}>
              {inventory.length === 0 ? (
                <p className="p-4 text-[13px] text-slate-400">Vuoto. Quello che riscatti nello Shop finisce qui.</p>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {inventory.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-100 break-words">{item.nome}</p>
                        <p className="text-xs text-slate-500 ds-num">×{item.quantity}</p>
                      </div>
                      <button type="button" onClick={() => setConsumeTarget(item)} className={`${BTN_GHOST} ds-btn-sm shrink-0`}>
                        Usa
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ---------------- SKILL TREE ---------------- */}
      {activeTab === 'skilltree' && (
        <section role="tabpanel" id="armory-tabpanel-skilltree" aria-labelledby="armory-tab-skilltree" className="space-y-5">
          <div className={`${CARD} !py-4 flex items-center justify-between flex-wrap gap-4`}>
            <div className="flex items-center gap-3">
              <span className="ds-icon-tile text-accent">
                <Icon name="chip" className="w-[18px] h-[18px]" />
              </span>
              <div>
                <p className="ds-eyebrow">Tech Token disponibili</p>
                <p className="text-2xl font-bold text-white ds-num">{formatInt(techTokens)}</p>
              </div>
            </div>
            <p className="text-[13px] text-slate-400 max-w-lg leading-relaxed">
              Un token per ogni livello superato, più un bonus ai traguardi di streak (7, 14, 30, 60 e 100 giorni). Le
              abilità sono passive e permanenti: una volta sbloccate lavorano da sole.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {PATH_ORDER.map((pathId) => {
              const meta = SKILL_PATH_META[pathId];
              const pathSkills = SKILL_TIER_ORDER.map((tierId) => SKILL_DEFS.find((s) => s.path === pathId && s.tier === tierId) || null);
              const attive = pathSkills.filter((s) => s && unlockedSkills.includes(s.id)).length;
              const totali = pathSkills.filter(Boolean).length;
              return (
                <div key={pathId} className="flex flex-col items-stretch">
                  <div className="flex items-center justify-between gap-2 mb-3 px-0.5">
                    <p className={`text-sm font-semibold ${meta.color}`}>{meta.label}</p>
                    <span className="text-xs text-slate-500 ds-num">
                      {attive}/{totali} attive
                    </span>
                  </div>
                  {pathSkills.map((skill, idx) => {
                    if (!skill) {
                      return (
                        <div key={`empty_${pathId}_${idx}`} className="rounded-xl border border-dashed border-white/10 p-3 text-center opacity-40">
                          <p className="text-[11px] text-slate-500">Percorso completo</p>
                        </div>
                      );
                    }
                    const unlocked = unlockedSkills.includes(skill.id);
                    const prereqMissing = !unlocked && !skill.requires.every((reqId) => unlockedSkills.includes(reqId));
                    const unlockable = !unlocked && canUnlockSkill(skill, unlockedSkills, techTokens);
                    const prevSkill = idx > 0 ? pathSkills[idx - 1] : null;
                    return (
                      <React.Fragment key={skill.id}>
                        {idx > 0 && prevSkill && <TierConnector active={unlockedSkills.includes(prevSkill.id)} />}
                        <SkillCard
                          skill={skill}
                          unlocked={unlocked}
                          unlockable={unlockable}
                          prereqMissing={prereqMissing}
                          techTokens={techTokens}
                          onUnlockClick={setUnlockTarget}
                        />
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------------- TROFEI ---------------- */}
      {activeTab === 'trofei' && (
        <section role="tabpanel" id="armory-tabpanel-trofei" aria-labelledby="armory-tab-trofei" className="space-y-6">
          {TIER_ORDER.map((tier) => {
            const meta = TIER_META[tier];
            const trophies = trophiesByTier[tier];
            if (!trophies || trophies.length === 0) return null;
            const sbloccati = trophies.filter((t) => t.unlocked).length;
            return (
              <div key={tier} className="space-y-3">
                <div className="flex items-center gap-3">
                  <p className={`text-sm font-semibold ${meta.color}`}>{meta.label}</p>
                  <span className="text-xs text-slate-500 ds-num">
                    {sbloccati}/{trophies.length}
                  </span>
                  <span className="ds-progress flex-1 max-w-[240px] !h-1">
                    <span className={TIER_BAR[tier] || 'bg-slate-400'} style={{ width: `${(sbloccati / trophies.length) * 100}%` }} />
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {trophies.map((t) => (
                    <div
                      key={t.id}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 ${
                        t.unlocked ? `bg-panel ${meta.border}` : 'bg-surface/60 border-line opacity-55'
                      }`}
                    >
                      <span
                        className={`w-10 h-10 rounded-lg flex items-center justify-center border shrink-0 ${
                          t.unlocked ? `${meta.border} ${meta.color} ${meta.bg}` : 'border-line text-slate-600 bg-panel'
                        }`}
                      >
                        {t.unlocked || !t.secret ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5" aria-hidden="true">
                            <path d={t.iconPath} />
                          </svg>
                        ) : (
                          <Icon name="lock" className="w-4 h-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold leading-snug ${t.unlocked ? 'text-slate-100' : 'text-slate-400'}`}>{t.nome}</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{t.descrizione}</p>
                        {t.unlocked && t.unlockedAt && <p className={`text-[11px] mt-1 ${meta.color}`}>Sbloccato il {formatDateHuman(t.unlockedAt)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ---------------- BLUEPRINTS ---------------- */}
      {activeTab === 'blueprints' && (
        <section role="tabpanel" id="armory-tabpanel-blueprints" aria-labelledby="armory-tab-blueprints" className="space-y-4">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="ds-h2">Blueprints</h2>
              <p className="text-[13px] text-slate-500 mt-0.5 max-w-2xl">
                Il formulario di ogni argomento completato: formule, teoremi e schemi da avere sotto mano prima dell'esame. Gli
                appunti di studio restano nell'argomento, nel Web-Matrix.
              </p>
            </div>
            {blueprintNodes.length > 6 && (
              <div className="relative w-full sm:w-72">
                <Icon name="search" className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={blueprintQuery}
                  onChange={(e) => setBlueprintQuery(e.target.value)}
                  placeholder="Cerca argomento o materia…"
                  className={`${INPUT} ds-input-sm !pl-9`}
                  aria-label="Cerca fra i Blueprint"
                />
              </div>
            )}
          </div>

          {blueprintNodes.length === 0 ? (
            <div className={CARD}>
              <EmptyState
                variant="tree"
                compact
                title="Nessun argomento completato ancora"
                subtitle="Quando chiudi un argomento nel Web-Matrix, qui si apre il suo formulario."
              />
            </div>
          ) : blueprintGroups.length === 0 ? (
            <p className="text-sm text-slate-400">Nessun risultato per «{blueprintQuery}».</p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
              {blueprintGroups.map((g) => (
                <div key={g.materiaId} className={CARD_NOPAD}>
                  <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
                    <p className="text-sm font-semibold text-white truncate">{g.materiaNome}</p>
                    <span className="text-xs text-slate-500 ds-num shrink-0">
                      {g.scritti}/{g.items.length} scritti
                    </span>
                  </div>
                  <ul className="p-1.5">
                    {g.items.map((entry) => (
                      <li key={entry.sfida.id}>
                        <button
                          type="button"
                          onClick={() => openDrawer(entry)}
                          className="group w-full text-left flex items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-white/[0.04] transition-colors"
                        >
                          <Icon
                            name={entry.sfida.blueprint ? 'book' : 'plus'}
                            className={`w-4 h-4 mt-0.5 shrink-0 ${entry.sfida.blueprint ? 'text-secondary' : 'text-slate-600'}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] text-slate-100 leading-snug break-words">{entry.sfida.nome}</span>
                            <span className="block text-xs text-slate-500 truncate">
                              {entry.sfida.blueprint ? entry.sfida.blueprint.split('\n')[0].slice(0, 90) : 'Formulario vuoto: clicca per scriverlo'}
                            </span>
                          </span>
                          <Icon name="edit" className="w-3.5 h-3.5 mt-1 text-slate-600 group-hover:text-slate-300 shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!unlockTarget}
        onClose={() => setUnlockTarget(null)}
        onConfirm={() => {
          actions.unlockSkill(unlockTarget.id);
          setUnlockTarget(null);
        }}
        title="Sbloccare l'abilità?"
        message={`"${unlockTarget?.title}" costa ${unlockTarget?.cost} Tech Token. L'effetto è permanente e parte subito.`}
        confirmLabel="Sblocca"
        danger={false}
      />

      <Modal open={rewardModalOpen} onClose={() => setRewardModalOpen(false)} title="Nuova ricompensa">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!rewardValida) return;
            actions.addShopReward(rewardNome.trim(), costoNum);
            setRewardNome('');
            setRewardCosto('500');
            setRewardModalOpen(false);
          }}
        >
          <div>
            <label className={LABEL} htmlFor="armory-reward-nome">
              Ricompensa
            </label>
            <input
              id="armory-reward-nome"
              type="text"
              maxLength={80}
              value={rewardNome}
              onChange={(e) => setRewardNome(e.target.value)}
              className={INPUT}
              placeholder="Es. Serata cinema"
              autoFocus
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="armory-reward-costo">
              Costo in XP
            </label>
            <input
              id="armory-reward-costo"
              type="number"
              min={1}
              step={10}
              value={rewardCosto}
              onChange={(e) => setRewardCosto(e.target.value)}
              className={`${INPUT} ds-num`}
            />
            <p className="text-xs text-slate-500 mt-1.5">
              Riferimento: una sessione di Focus da 25 minuti vale in media qualche decina di XP. Oggi hai {formatInt(bankedXp)} XP
              da spendere.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => setRewardModalOpen(false)} className={BTN_GHOST}>
              Annulla
            </button>
            <button type="submit" disabled={!rewardValida} className={BTN_AMBER}>
              Aggiungi allo Shop
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteRewardTarget}
        onClose={() => setDeleteRewardTarget(null)}
        onConfirm={() => actions.deleteShopReward(deleteRewardTarget.id)}
        title="Eliminare la ricompensa?"
        message={`"${deleteRewardTarget?.nome}" sparisce dallo Shop. Quelle già riscattate restano nell'inventario.`}
        confirmLabel="Elimina"
      />

      <ConfirmDialog
        open={!!redeemTarget}
        onClose={() => setRedeemTarget(null)}
        onConfirm={() => actions.redeemShopReward(redeemTarget.id, redeemTarget.nome)}
        title="Riscattare la ricompensa?"
        message={`"${redeemTarget?.nome}" costa ${formatInt(redeemTarget?.costoXp)} XP. Finisce nell'inventario, pronta quando vuoi.`}
        confirmLabel="Riscatta"
        danger={false}
      />

      <ConfirmDialog
        open={!!consumeTarget}
        onClose={() => setConsumeTarget(null)}
        onConfirm={() => actions.consumeInventoryItem(consumeTarget.id)}
        title="Usare la ricompensa?"
        message={`Te la godi adesso: "${consumeTarget?.nome}". Te la sei guadagnata.`}
        confirmLabel="Usala"
        danger={false}
      />

      {/* Drawer del Blueprint — salvataggio automatico. */}
      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        eyebrow="Blueprint · formulario"
        eyebrowClassName="text-slate-400"
        title={drawerData?.sfida?.nome || ''}
        subtitle={drawerData?.materiaNome}
      >
        <div className="flex-1 min-h-0 p-5 flex flex-col">
          <textarea
            value={drawerText}
            onChange={(e) => handleDrawerTextChange(e.target.value)}
            placeholder={'Formule, teoremi, schemi da ricordare…\nEs. Bernoulli: p + ½ρv² + ρgz = costante'}
            className={`${INPUT} flex-1 font-mono text-[13px] leading-relaxed resize-none af-scroll`}
            aria-label="Testo del Blueprint"
          />
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <Icon name="cloudCheck" className="w-3.5 h-3.5" />
            Si salva da solo mentre scrivi.
          </p>
        </div>
      </Drawer>
    </div>
  );
}
