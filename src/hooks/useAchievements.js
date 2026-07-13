import { useEffect } from 'react';
import { evaluateTrophies, TIER } from '../data/trophies.js';

/**
 * useAchievements — "The Achievement Engine" (V23.0, Modulo 3).
 *
 * Estratto dal ArachnoForgeContext (che prima conteneva questa logica
 * inline) in un vero custom hook dedicato, come richiesto dalla Direttiva
 * Suprema ("Event Listener Hook... monitora l'AeroForgeContext"). Ascolta
 * in background lo stato globale e, ad ogni render in cui una condizione
 * di trofeo precedentemente bloccata risulta ora vera, dispatcha
 * `UNLOCK_TROPHIES` e notifica l'utente con una Toast dedicata.
 *
 * Fanfara "tiered": i trofei Multiverse (i più rari, quasi sempre segreti)
 * ricevono il Trophy Fanfare esteso invece del solito Level Up Chime — un
 * feedback sonoro proporzionato alla rarità dell'impresa appena compiuta.
 *
 * Puramente "ascoltatore": non possiede stato proprio, non ritorna nulla.
 * Tutta la logica di valutazione resta in `evaluateTrophies` (pura,
 * testabile in isolamento) — l'hook si limita a orchestrare quando
 * rivalutarla e cosa fare alla prima transizione bloccato -> sbloccato.
 */
export function useAchievements({ state, dispatch, pushToast, audio }) {
  useEffect(() => {
    const unlockedIds = new Set(state.trophies.map((t) => t.id));
    const evaluated = evaluateTrophies(state);
    const newlyUnlocked = evaluated.filter((t) => t.unlocked && !unlockedIds.has(t.id));

    if (newlyUnlocked.length === 0) return;

    dispatch({ type: 'UNLOCK_TROPHIES', payload: { ids: newlyUnlocked.map((t) => t.id) } });
    newlyUnlocked.forEach((t) => {
      pushToast(`🏆 Trofeo Sbloccato! — ${t.nome}`, 'trophy');
    });

    // I trofei Multiverse sono i più rari del Ragno-Verso: meritano un
    // fanfare più ricco e "definitivo" del Level Up Chime standard.
    if (newlyUnlocked.some((t) => t.tier === TIER.MULTIVERSE)) {
      audio.playTrophyFanfare();
    } else {
      audio.playLevelUpChime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.profile.streak,
    state.profile.overdriveCount,
    state.profile.bloodPactCount,
    state.profile.reviewsCompleted,
    state.profile.hardNodesCompleted,
    state.profile.quickQuestsUsed,
    state.profile.lastStandCount,
    state.profile.level,
    state.profile.dailyPatrolsCompleted,
    // V33.1 — Sinister Six Gauntlet: senza questa dipendenza esplicita, il
    // trofeo "Gauntlet Impeccabile" verrebbe rilevato solo per un effetto
    // collaterale incidentale (GAUNTLET_CLEARED viaggia sempre insieme a
    // un BOSS_FIGHT_RESULT che tocca già `state.starLog`, già tracciato
    // qui sotto) — corretto per ora, ma fragile e non esplicito. Elencarlo
    // qui rende la dipendenza reale, non un caso fortunato.
    state.profile.gauntletsCleared,
    state.materie,
    state.starLog,
    dispatch,
    pushToast,
    audio
  ]);
}

export default useAchievements;
