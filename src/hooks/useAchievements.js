import { useEffect, useRef } from 'react';
import { TIER } from '../data/trophies.js';

/**
 * useAchievements — "The Achievement Engine" (V23.0, Modulo 3).
 *
 * Ascolta lo stato globale e, alla prima transizione bloccato ->
 * sbloccato di un trofeo, dispatcha `UNLOCK_TROPHIES` e notifica il
 * Cadetto con una Toast dedicata. Fanfara "tiered": i trofei Multiverse
 * (i più rari) ricevono il Trophy Fanfare esteso invece del Level Up
 * Chime, un feedback proporzionato alla rarità dell'impresa.
 *
 * V37.0 — L'hook non valuta più i trofei per conto proprio.
 * `evaluateTrophies` è una scansione completa di profilo, materie, nodi
 * e starLog, e girava DUE volte per ogni cambio di stato: una qui e una
 * dentro il `derived` del Provider, che ne ha comunque bisogno per la
 * Sala Trofei. Ora la valutazione avviene una sola volta a monte e
 * arriva qui già pronta (`evaluated`). Stessa logica, metà lavoro.
 *
 * I nomi dei trofei viaggiano nel payload del dispatch: il reducer non
 * deve più rivalutare l'intero stato solo per scrivere una riga di log.
 *
 * Puramente "ascoltatore": non possiede stato proprio, non ritorna nulla.
 */
export function useAchievements({ evaluated, unlockedIds, dispatch, pushToast, audio }) {
  // Guardia anti doppio-dispatch: fra il dispatch e il render successivo
  // `unlockedIds` non è ancora aggiornato, e in StrictMode l'effetto può
  // rigirare sullo stesso input. Ricordare cosa è già stato annunciato
  // evita una seconda Toast per lo stesso trofeo.
  const announcedRef = useRef(new Set());

  useEffect(() => {
    const newlyUnlocked = evaluated.filter(
      (t) => t.unlocked && !unlockedIds.has(t.id) && !announcedRef.current.has(t.id)
    );
    if (newlyUnlocked.length === 0) return;

    newlyUnlocked.forEach((t) => announcedRef.current.add(t.id));

    dispatch({
      type: 'UNLOCK_TROPHIES',
      payload: { ids: newlyUnlocked.map((t) => t.id), names: newlyUnlocked.map((t) => t.nome) }
    });
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
  }, [evaluated, unlockedIds, dispatch, pushToast, audio]);
}

export default useAchievements;
