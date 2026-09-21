import { useRef, useEffect, useMemo } from 'react';
import { getRankTitle, getRankMeta, computeTotalBankedXp, xpRequiredForLevel } from '../utils/xpEngine.js';

/**
 * useProgression — deriva titolo di grado, XP totale "bancato" e
 * percentuale di avanzamento del livello corrente dal profilo, e notifica
 * via toast ogni Level Up (rilevato per diff sul livello, indipendentemente
 * dalla fonte dell'XP: Focus, nodo completato, ripasso, Boss Fight).
 *
 * V25.0 — "The Endgame": il Level Up ora distingue anche il caso "cambio
 * di banda di rango" (es. da Lv.9 "Bimbo Ragno" a Lv.10 "Ragno di
 * Quartiere"), con una toast dedicata più enfatica — la progressione deve
 * SENTIRSI diversa quando si sblocca un nuovo titolo, non solo un numero.
 *
 * Estratto dal ArachnoForgeContext (Fase 2 — Custom Hooks & State Split)
 * per tenere in un solo posto tutta la logica "di carriera" del giocatore.
 */
export function useProgression(profile, pushToast, audio) {
  const prevLevelRef = useRef(profile.level);

  useEffect(() => {
    if (profile.level > prevLevelRef.current) {
      const prevTier = getRankMeta(prevLevelRef.current);
      const nextTier = getRankMeta(profile.level);
      if (nextTier.title !== prevTier.title) {
        pushToast(`NUOVO RANGO — ${nextTier.title} (Lv.${profile.level})`, 'levelup');
        if (audio && typeof audio.playTrophyFanfare === 'function') audio.playTrophyFanfare();
      } else {
        pushToast(`LIVELLO SUPERATO — ${nextTier.title} (Lv.${profile.level})`, 'levelup');
      }
    }
    prevLevelRef.current = profile.level;
  }, [profile.level, pushToast, audio]);

  return useMemo(() => {
    const xpNeeded = xpRequiredForLevel(profile.level);
    const xpPct = Math.min(100, Math.round((profile.currentXp / xpNeeded) * 100));
    return {
      rankTitle: getRankTitle(profile.level),
      rankMeta: getRankMeta(profile.level),
      totalBankedXp: computeTotalBankedXp(profile),
      xpNeeded,
      xpPct
    };
  }, [profile]);
}

export default useProgression;
