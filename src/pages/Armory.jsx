import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { NODE_STATUS, deriveNodeStatus } from '../utils/skillTree.js';
import { formatDateHuman } from '../utils/dateUtils.js';
import { TIER, TIER_META } from '../data/trophies.js';
import { SKILL_DEFS, SKILL_PATH, SKILL_PATH_META, SKILL_TIER, canUnlockSkill } from '../data/techTree.js';
import { CARD, H1, H2, BTN_PRIMARY, BTN_SECONDARY, BTN_AMBER, BTN_GHOST, INPUT, BADGE } from '../utils/designSystem.js';

const TIER_ORDER = [TIER.NEIGHBORHOOD, TIER.AVENGER, TIER.MULTIVERSE];
const DRAWER_TRANSITION_MS = 300;

const PATH_ORDER = [SKILL_PATH.DEFENSE, SKILL_PATH.EFFICIENCY, SKILL_PATH.AGGRESSION];
const SKILL_TIER_ORDER = [SKILL_TIER.T1, SKILL_TIER.T2, SKILL_TIER.T3];

const ARMORY_TABS = [
  { id: 'lab', label: 'Blueprints, Shop & Trofei', icon: 'flask' },
  { id: 'skilltree', label: 'Skill Tree', icon: 'chip' }
];

/** Card di una singola abilità dello Skill Tree — 4 stati visivi distinti:
 * sbloccata, sbloccabile ora (Token sufficienti + prerequisiti ok, pulsa
 * per invitare il click), bloccata per prerequisiti mancanti, bloccata
 * solo per Token insufficienti (prerequisiti già ok). */
function SkillCard({ skill, unlocked, unlockable, prereqMissing, techTokens, onUnlockClick }) {
  const meta = SKILL_PATH_META[skill.path];
  const lockedByTokensOnly = !unlocked && !prereqMissing && techTokens < skill.cost;

  return (
    <div
      className={`relative rounded-2xl border p-4 transition-all duration-300 overflow-hidden group ${
        unlocked
          ? `bg-surface/70 backdrop-blur-2xl ${meta.border} shadow-[0_8px_24px_rgba(0,0,0,0.4)]`
          : prereqMissing
          ? 'bg-surface/40 backdrop-blur-md border-white/5 opacity-40 grayscale'
          : unlockable
          ? `bg-surface/60 backdrop-blur-xl ${meta.border} animate-token-pulse hover:-translate-y-1`
          : 'bg-surface/50 backdrop-blur-md border-white/10 hover:-translate-y-0.5'
      }`}
    >
      {unlocked && <div className={`absolute -inset-6 rounded-full ${meta.color.replace('text-', 'bg-')}/10 blur-2xl pointer-events-none`} />}
      <div className="relative flex items-start justify-between gap-2">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
          unlocked ? `${meta.border} ${meta.color} bg-surface/60` : 'border-white/10 text-slate-500 bg-surface/40'
        }`}>
          <Icon name={skill.icon} className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" />
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono border shrink-0 ${
          unlocked ? 'bg-emerald-900/40 text-emerald-300 border-emerald-400/30' : `${meta.border} ${meta.color} bg-surface/50`
        }`}>
          <Icon name="chip" className="w-3 h-3" />
          {unlocked ? 'ATTIVA' : `${skill.cost} TOKEN`}
        </span>
      </div>
      <p className="relative text-sm font-bold text-slate-100 mt-2.5 leading-snug">{skill.title}</p>
      <p className={`relative text-[11px] font-mono mt-0.5 ${unlocked ? meta.color : 'text-slate-500'}`}>{skill.tagline}</p>
      <p className="relative text-[11px] text-slate-500 mt-2 leading-relaxed min-h-[3.4em]">{skill.description}</p>
      {!unlocked && (
        <button
          type="button"
          disabled={!unlockable}
          onClick={() => onUnlockClick(skill)}
          title={prereqMissing ? 'Prerequisito non ancora sbloccato' : lockedByTokensOnly ? 'Tech Token insufficienti' : ''}
          className={`relative w-full mt-3 !px-3 !py-2 !text-[11px] ${unlockable ? BTN_AMBER : `${BTN_GHOST} opacity-50 cursor-not-allowed`}`}
        >
          {prereqMissing ? (
            <>
              <Icon name="skull" className="w-3.5 h-3.5" />
              Bloccata
            </>
          ) : (
            <>
              <Icon name="bolt" className="w-3.5 h-3.5" />
              Sblocca ({skill.cost})
            </>
          )}
        </button>
      )}
      {unlocked && (
        <p className="relative text-[10px] mt-3 font-mono text-emerald-400 flex items-center gap-1">
          <Icon name="check" className="w-3.5 h-3.5" />
          Abilità attiva
        </p>
      )}
    </div>
  );
}

/** Connettore visivo verticale fra due tier della stessa corsia — si accende quando il nodo sopra è sbloccato. */
function TierConnector({ active }) {
  return (
    <div className="flex items-center justify-center h-6">
      <div className={`w-0.5 h-full rounded-full transition-colors duration-500 ${active ? 'bg-accent/60' : 'bg-white/10'}`} />
    </div>
  );
}

export default function Armory() {
  const { state, actions, derived } = useArachnoForge();
  const [activeTab, setActiveTab] = useState('lab');
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [rewardNome, setRewardNome] = useState('');
  const [rewardCosto, setRewardCosto] = useState(500);
  const [deleteRewardTarget, setDeleteRewardTarget] = useState(null);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [consumeTarget, setConsumeTarget] = useState(null);
  const [unlockTarget, setUnlockTarget] = useState(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerData, setDrawerData] = useState(null); // { materiaId, materiaNome, sfida }
  const [drawerText, setDrawerText] = useState('');
  const saveTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);

  const blueprintNodes = useMemo(() => {
    const list = [];
    (Array.isArray(state.materie) ? state.materie : []).forEach((m) => {
      (Array.isArray(m?.sfide) ? m.sfide : []).forEach((s) => {
        const status = deriveNodeStatus(s, m.sfide);
        if (status === NODE_STATUS.COMPLETED || status === NODE_STATUS.NEEDS_REVIEW) {
          list.push({ materiaId: m.id, materiaNome: m.nome, sfida: s });
        }
      });
    });
    return list;
  }, [state.materie]);

  useEffect(() => () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
  }, []);

  const openDrawer = (entry) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setDrawerData(entry);
    setDrawerText(entry.sfida.blueprint || '');
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    closeTimeoutRef.current = setTimeout(() => setDrawerData(null), DRAWER_TRANSITION_MS);
  };

  const handleDrawerTextChange = (value) => {
    setDrawerText(value);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (drawerData) actions.updateSfida(drawerData.materiaId, drawerData.sfida.id, { blueprint: value });
    }, 400);
  };

  const trophiesByTier = useMemo(() => {
    const grouped = { [TIER.NEIGHBORHOOD]: [], [TIER.AVENGER]: [], [TIER.MULTIVERSE]: [] };
    derived.trophyList.forEach((t) => {
      if (grouped[t.tier]) grouped[t.tier].push(t);
    });
    return grouped;
  }, [derived.trophyList]);

  return (
    <div className="space-y-9">
      <div>
        <h1 className={H1}>Suit Lab & Trophies</h1>
        <p className="text-base text-slate-400 mt-1.5">Karen: laboratorio del costume online. Blueprints, Reward Shop, Inventario, Trophy Room e Skill Tree.</p>
      </div>

      {/* Tab switcher — V25.0: la Suit Lab ospita ora anche il Mini Skill
          Tree (Pillar 3), separato in una scheda dedicata per non
          affollare la pagina originale di Blueprints/Shop/Trofei. */}
      <div className="flex items-center gap-2 border-b border-secondary/15 pb-0">
        {ARMORY_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold tracking-wide transition-all duration-300 border-b-2 -mb-px ${
                active ? 'text-white border-primary' : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}
            >
              <Icon name={tab.icon} className={`w-4 h-4 ${active ? 'text-primary' : ''}`} />
              {tab.label}
              {tab.id === 'skilltree' && (state.profile.techTokens || 0) > 0 && (
                <span className="ml-1 w-2 h-2 rounded-full bg-accent shadow-accent-glow" />
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'lab' && (
      <>
      <section>
        <h2 className={`${H2} mb-4 flex items-center gap-2`}>
          <Icon name="book" className="w-5 h-5 text-secondary" />
          BLUEPRINTS
        </h2>
        {blueprintNodes.length === 0 ? (
          <div className={CARD}>
            <p className="relative text-base text-slate-400">
              Karen: nessun nodo completato ancora. I Blueprint sbloccano un editor per formule e teoremi una volta superato un nodo.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {blueprintNodes.map((entry) => (
              <button
                key={entry.sfida.id}
                type="button"
                onClick={() => openDrawer(entry)}
                className="text-left bg-surface/70 backdrop-blur-2xl border border-secondary/20 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-4 hover:border-secondary/50 hover:-translate-y-1 transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-base font-medium truncate text-slate-100">{entry.sfida.nome}</p>
                  <Icon name="edit" className="w-5 h-5 text-slate-500 shrink-0" />
                </div>
                <p className="text-xs text-slate-500">{entry.materiaNome}</p>
                <p className="text-[11px] text-slate-500 mt-2 line-clamp-2 min-h-[2.2em]">
                  {entry.sfida.blueprint ? entry.sfida.blueprint.slice(0, 80) : 'Nessun appunto ancora — clicca per aprire.'}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`${H2} flex items-center gap-2`}>
            <Icon name="target" className="w-5 h-5 text-accent" />
            REWARD SHOP
          </h2>
          <button type="button" onClick={() => setRewardModalOpen(true)} className={BTN_SECONDARY}>
            <Icon name="plus" className="w-5 h-5" />
            Ricompensa
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">XP disponibile: <span className={BADGE.amber}>{derived.totalBankedXp}</span></p>
        {state.shopRewards.length === 0 ? (
          <div className={CARD}>
            <p className="relative text-base text-slate-400">
              Nessuna ricompensa configurata. Aggiungine una: costerà XP dal tuo profilo per essere riscattata.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {state.shopRewards.map((r) => {
              const affordable = derived.totalBankedXp >= r.costoXp;
              return (
                <div key={r.id} className={`${CARD} flex items-center justify-between`}>
                  <div className="relative">
                    <p className="text-base font-medium text-slate-100">{r.nome}</p>
                    <p className="text-base font-mono text-accent mt-1">{r.costoXp} XP</p>
                  </div>
                  <div className="relative flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => affordable && setRedeemTarget(r)}
                      disabled={!affordable}
                      title={affordable ? '' : 'XP insufficiente'}
                      className={`${BTN_AMBER} !px-3.5 !py-2 !text-xs`}
                    >
                      Riscatta
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteRewardTarget(r)}
                      className="text-slate-500 hover:text-primary transition-all duration-300"
                      aria-label="Elimina ricompensa"
                    >
                      <Icon name="trash" className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className={`${H2} mb-4 flex items-center gap-2`}>
          <Icon name="archive" className="w-5 h-5 text-secondary" />
          INVENTARIO
        </h2>
        {state.inventory.length === 0 ? (
          <div className={CARD}>
            <p className="relative text-base text-slate-400">
              Inventario vuoto. Le ricompense riscattate dallo Shop finiscono qui, pronte da consumare quando vuoi.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {state.inventory.map((item) => (
              <div key={item.id} className={`${CARD} flex items-center justify-between`}>
                <div className="relative">
                  <p className="text-base font-medium text-slate-100">{item.nome}</p>
                  <p className="text-base font-mono text-accent mt-1">x{item.quantity}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setConsumeTarget(item)}
                  className={`relative ${BTN_SECONDARY} !px-3.5 !py-2 !text-xs`}
                >
                  Consuma
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <h2 className={`${H2} flex items-center gap-2`}>
            <Icon name="trophy" className="w-5 h-5 text-accent" />
            TROPHY ROOM
          </h2>
          <span className={BADGE.amber}>
            <Icon name="chip" className="w-3.5 h-3.5" />
            {derived.trophyList.filter((t) => t.unlocked).length} / {derived.trophyList.length} sbloccati
          </span>
        </div>
        <div className="space-y-6">
          {TIER_ORDER.map((tier) => {
            const meta = TIER_META[tier];
            const trophies = trophiesByTier[tier];
            if (!trophies || trophies.length === 0) return null;
            return (
              <div key={tier}>
                <p className={`text-base font-mono tracking-widest mb-3 ${meta.color}`}>{meta.label.toUpperCase()}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-5">
                  {trophies.map((t) => (
                    <div
                      key={t.id}
                      className={`relative rounded-2xl border p-5 text-center transition-all duration-300 overflow-hidden ${
                        t.unlocked
                          ? `bg-surface/70 backdrop-blur-2xl ${meta.border} ${meta.glow}`
                          : 'bg-surface/40 backdrop-blur-md border-white/5 opacity-30 grayscale'
                      }`}
                    >
                      {t.unlocked && <div className={`absolute -inset-4 rounded-full ${meta.bg} blur-2xl pointer-events-none`} />}
                      <div className={`relative w-12 h-12 mx-auto rounded-xl flex items-center justify-center border ${t.unlocked ? meta.border : 'border-white/10'} ${t.unlocked ? meta.color : 'text-slate-500'} bg-surface/60`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-6 h-6">
                          <path d={t.iconPath} />
                        </svg>
                      </div>
                      <p className="relative text-base font-semibold mt-3 leading-snug text-slate-100">{t.nome}</p>
                      <p className="relative text-xs text-slate-500 mt-1.5 leading-relaxed">{t.descrizione}</p>
                      {t.unlocked && t.unlockedAt && (
                        <p className={`relative text-[10px] mt-2 font-mono ${meta.color}`}>{formatDateHuman(t.unlockedAt)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      </>
      )}

      {activeTab === 'skilltree' && (
      <section className="space-y-6">
        <div className={`${CARD} flex items-center justify-between flex-wrap gap-4`}>
          <div className="relative flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/40 flex items-center justify-center text-accent shrink-0">
              <Icon name="chip" className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs tracking-widest text-accent font-mono">TECH TOKEN DISPONIBILI</p>
              <p className="text-2xl font-mono font-bold text-white af-mono-nums">{state.profile.techTokens || 0}</p>
            </div>
          </div>
          <p className="relative text-xs text-slate-500 max-w-sm leading-relaxed">
            Karen: 1 Tech Token per ogni Livello superato. Investili in abilità passive permanenti — nessun potenziamento va mai riattivato manualmente.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {PATH_ORDER.map((pathId) => {
            const meta = SKILL_PATH_META[pathId];
            const pathSkills = SKILL_TIER_ORDER.map((tierId) => SKILL_DEFS.find((s) => s.path === pathId && s.tier === tierId) || null);
            return (
              <div key={pathId} className="flex flex-col items-stretch">
                <p className={`text-center text-xs font-mono tracking-widest mb-3 ${meta.color}`}>{meta.label.toUpperCase()}</p>
                {pathSkills.map((skill, idx) => {
                  if (!skill) {
                    return (
                      <div key={`empty_${pathId}_${idx}`} className="rounded-2xl border border-dashed border-white/10 p-4 text-center opacity-30">
                        <p className="text-[11px] text-slate-500">Percorso completo</p>
                      </div>
                    );
                  }
                  const unlockedSkills = Array.isArray(state.profile.unlockedSkills) ? state.profile.unlockedSkills : [];
                  const unlocked = unlockedSkills.includes(skill.id);
                  const prereqMissing = !unlocked && !skill.requires.every((reqId) => unlockedSkills.includes(reqId));
                  const unlockable = !unlocked && canUnlockSkill(skill, unlockedSkills, state.profile.techTokens || 0);
                  const prevSkill = idx > 0 ? pathSkills[idx - 1] : null;
                  return (
                    <React.Fragment key={skill.id}>
                      {idx > 0 && prevSkill && <TierConnector active={unlockedSkills.includes(prevSkill.id)} />}
                      <SkillCard
                        skill={skill}
                        unlocked={unlocked}
                        unlockable={unlockable}
                        prereqMissing={prereqMissing}
                        techTokens={state.profile.techTokens || 0}
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

      <ConfirmDialog
        open={!!unlockTarget}
        onClose={() => setUnlockTarget(null)}
        onConfirm={() => {
          actions.unlockSkill(unlockTarget.id);
          setUnlockTarget(null);
        }}
        title="Sblocca Abilità"
        message={`Sbloccare "${unlockTarget?.title}" per ${unlockTarget?.cost} Tech Token? L'effetto sarà permanente e immediato.`}
        confirmLabel="Sblocca"
        danger={false}
      />

      <Modal open={rewardModalOpen} onClose={() => setRewardModalOpen(false)} title="Nuova Ricompensa">
        <div className="space-y-4">
          <div>
            <label className="text-base text-slate-400 block mb-1.5">Nome ricompensa</label>
            <input
              type="text"
              value={rewardNome}
              onChange={(e) => setRewardNome(e.target.value)}
              className={INPUT}
              placeholder="Es. Serata cinema"
            />
          </div>
          <div>
            <label className="text-base text-slate-400 block mb-1.5">Costo (XP)</label>
            <input
              type="number"
              min={1}
              value={rewardCosto}
              onChange={(e) => setRewardCosto(Number(e.target.value))}
              className={INPUT}
            />
          </div>
          <button
            type="button"
            disabled={!rewardNome.trim()}
            onClick={() => {
              actions.addShopReward(rewardNome.trim(), rewardCosto);
              setRewardNome('');
              setRewardCosto(500);
              setRewardModalOpen(false);
            }}
            className={`w-full ${BTN_AMBER}`}
          >
            Aggiungi allo Shop
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteRewardTarget}
        onClose={() => setDeleteRewardTarget(null)}
        onConfirm={() => actions.deleteShopReward(deleteRewardTarget.id)}
        title="Elimina Ricompensa"
        message={`Rimuovere "${deleteRewardTarget?.nome}" dallo Shop?`}
        confirmLabel="Elimina"
      />

      <ConfirmDialog
        open={!!redeemTarget}
        onClose={() => setRedeemTarget(null)}
        onConfirm={() => actions.redeemShopReward(redeemTarget.id, redeemTarget.nome)}
        title="Riscatta Ricompensa"
        message={`Riscattare "${redeemTarget?.nome}" per ${redeemTarget?.costoXp} XP? Finirà nel tuo Inventario, pronta da consumare quando vuoi.`}
        confirmLabel="Riscatta"
        danger={false}
      />

      <ConfirmDialog
        open={!!consumeTarget}
        onClose={() => setConsumeTarget(null)}
        onConfirm={() => actions.consumeInventoryItem(consumeTarget.id)}
        title="Consuma Ricompensa"
        message={`Confermi di voler goderti ora "${consumeTarget?.nome}"?`}
        confirmLabel="Consuma"
        danger={false}
      />

      {/* Side-Drawer Blueprints — glassmorphism, auto-save */}
      {drawerData && (
        <div className="fixed inset-0 z-[70]">
          <div
            className={`absolute inset-0 bg-surface/75 backdrop-blur-sm transition-opacity duration-300 ${drawerOpen ? 'opacity-100' : 'opacity-0'}`}
            onClick={closeDrawer}
          />
          <div
            className={`absolute top-0 right-0 h-full w-full max-w-md bg-surface/90 backdrop-blur-2xl border-l border-secondary/20 shadow-2xl flex flex-col transition-transform duration-300 ${
              drawerOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-secondary/15">
              <div>
                <p className="text-base text-slate-500 tracking-widest">BLUEPRINT</p>
                <p className="text-base font-semibold mt-0.5 text-white">{drawerData.sfida.nome}</p>
                <p className="text-xs text-slate-500">{drawerData.materiaNome}</p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="text-slate-500 hover:text-primary transition-all duration-300"
                aria-label="Chiudi drawer"
              >
                <Icon name="close" className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 p-5 flex flex-col">
              <textarea
                value={drawerText}
                onChange={(e) => handleDrawerTextChange(e.target.value)}
                placeholder="Formule, teoremi, appunti sintetici..."
                className={`${INPUT} flex-1 font-mono resize-none af-scroll`}
              />
              <p className="text-xs text-slate-500 mt-2">Salvataggio automatico attivo.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
