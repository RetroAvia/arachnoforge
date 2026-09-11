import { useRef, useCallback, useEffect, useMemo } from 'react';
import {
  synthWebClick,
  synthSuccessChime,
  synthHoverBlip,
  synthFocusReminder,
  synthPenaltyBuzzer,
  synthLevelUpChime,
  synthGoblinAlert,
  synthQuestComplete,
  synthTrophyFanfare,
  synthSkillUnlock,
  synthAccessDenied,
  synthAccessGranted,
  synthTypingTic,
  synthMaxCarnageActivate,
  synthWebSlingReveal,
  synthChestOpen,
  synthSpiderSenseUnlock,
  synthDataImport,
  synthDeleteWhoosh
} from './audio-engine/sounds.js';

/**
 * Web-Master Sound Design — motore audio 100% procedurale via Web Audio
 * API nativa. Nessun file .mp3/.wav esterno: ogni effetto è sintetizzato
 * al volo con oscillatori + inviluppi di gain, pensato per restare
 * discreto/enterprise-grade (mai invadente, mai "gamey" a tutto volume).
 *
 * L'AudioContext è condiviso a livello di modulo (singleton) perché i
 * browser limitano il numero di contesti attivi e perché costruirne uno
 * per ogni componente che vuole riprodurre un suono sarebbe sprecato.
 * Viene creato "lazy" al primo suono richiesto (mai in fase di import),
 * così nessun browser blocca la creazione per policy di autoplay: il
 * primo playXxx() avviene sempre in risposta a un gesto utente (click).
 */
let sharedCtx = null;
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx) {
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

/**
 * @param {object} params
 * @param {boolean} params.enabled - flag corrente (settings.soundEffects && !sensoryZero).
 *   Letto tramite ref per evitare di dover ricreare le funzioni play* ad
 *   ogni cambio di toggle (che romperebbe la stabilità dei riferimenti
 *   passati più in basso nell'albero).
 */
export function useAudioEngine({ enabled = true } = {}) {
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const ensureRunning = useCallback((ctx) => {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }, []);

  // V27.0 — Pillar 3 (Maximum Carnage Mode): riferimento agli oscillatori
  // del "drone" simbionte in corso, cosi' che stopMaxCarnageDrone() possa
  // spegnerlo esplicitamente (scadenza naturale a 2h o disattivazione
  // manuale) senza dover ricreare l'intero AudioContext.
  const carnageDroneRef = useRef(null);

  /** Web-Click — blip breve e ovattato per i pulsanti primari, in tutta l'app. */
  const playWebClick = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthWebClick(ctx);
  }, [ensureRunning]);

  /** Success Chime — arpeggio ascendente gentile per nodi/quest completati. */
  const playSuccessChime = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthSuccessChime(ctx);
  }, [ensureRunning]);

  /**
   * Hover Blip — micro-click ad altissima frequenza, volume bassissimo,
   * per i bottoni principali (Primary/Secondary/Success/Amber) al passaggio
   * del mouse. Deliberatamente più corto e discreto del Web-Click (che
   * suona al click reale): serve solo come "respiro" tattile della UI,
   * mai fastidioso anche passando rapidamente su più pulsanti in fila.
   */
  const playHoverBlip = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthHoverBlip(ctx);
  }, [ensureRunning]);

  /**
   * Focus Reminder — "rintocco tibetano / ping di navigazione spaziale":
   * due toni morbidi in ottava (campana + sub-armonica), riprodotto ogni
   * 30 minuti esatti di Focus ininterrotto (Mission Control / Stark-Web
   * Terminal) per mantenere l'utente nel Flow State senza spezzarlo con
   * un suono brusco.
   */
  const playFocusReminder = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthFocusReminder(ctx);
  }, [ensureRunning]);

  /**
   * Penalty Buzzer — ronzio distorto e grave (sawtooth + waveshaper), per
   * la Boss Fight quando si sbircia una soluzione. Volutamente sgradevole
   * (ma breve): un feedback negativo netto, mai un semplice "click".
   */
  const playPenaltyBuzzer = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthPenaltyBuzzer(ctx);
  }, [ensureRunning]);

  /**
   * Level Up Chime — arpeggio eroico (5 note, più ricco del Success
   * Chime) per la sconfitta di un Supercriminale (Sinister Six Simulator)
   * o il completamento di un Nodo Padre ("Boss" dello Skill Tree).
   */
  const playLevelUpChime = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthLevelUpChime(ctx);
  }, [ensureRunning]);

  /** Goblin Alert — ronzio grave e ansiogeno (low-pass) per la fase Enrage. */
  const playGoblinAlert = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthGoblinAlert(ctx);
  }, [ensureRunning]);

  /**
   * Quest Complete — V23.0 (Modulo 2): triade "arcade" (onda quadra,
   * intervalli di quinta+ottava) per il completamento di una missione
   * della Daily Patrol. Deliberatamente diverso dal Success Chime (nodi
   * dello Skill Tree) per dare all'utente un feedback sonoro distinto fra
   * "ho completato un nodo" e "ho completato una missione giornaliera".
   */
  const playQuestComplete = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthQuestComplete(ctx);
  }, [ensureRunning]);

  /**
   * Trophy Fanfare — arpeggio esteso a 7 note (più ricco del Level Up
   * Chime), riservato ai trofei di Tier Multiverse: le imprese più rare
   * del Ragno-Verso meritano il suono più "definitivo" dell'intero motore
   * audio, con le ultime due note in sawtooth per un finale più "epico".
   */
  const playTrophyFanfare = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthTrophyFanfare(ctx);
  }, [ensureRunning]);

  /**
   * V25.0 — Pillar 4 (Advanced Audio Engine): Skill Unlock — riservato allo
   * sblocco di un'abilità nello Skill Tree della Suit Lab. Deliberatamente
   * DIVERSO sia dal Level Up Chime (eroico, 5 note fisse) sia dalla Trophy
   * Fanfare (epica, 7 note fisse): qui l'identità è "tecnologica/digitale"
   * — un thunk meccanico grave di "sblocco" seguito da un arpeggio breve
   * la cui tonalità di base e il set di forme d'onda vengono scelti a
   * caso ad ogni invocazione (root pitch fra 3 varianti, alternanza
   * square/triangle per nota), cosi' che due sblocchi consecutivi non
   * suonino MAI in modo identico, pur restando riconoscibili come "stessa
   * famiglia" di suono.
   */
  const playSkillUnlock = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthSkillUnlock(ctx);
  }, [ensureRunning]);

  /**
   * V26.0 — Pillar 1 (The Nexus Gate): Access Denied — ronzio grave a
   * doppio impulso dissonante (due toni leggermente stonati fra loro),
   * riservato agli errori di autenticazione ("Credenziali errate",
   * "Recluta già registrata"...). Deliberatamente più "digitale/freddo"
   * del Penalty Buzzer della Boss Fight (che è analogico/sawtooth): qui
   * la distorsione è quasi assente, il messaggio è "porta bloccata", non
   * "hai sbagliato una mossa".
   */
  const playAccessDenied = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthAccessDenied(ctx);
  }, [ensureRunning]);

  /**
   * V26.0 — Pillar 1 (The Nexus Gate): Access Granted — chime epico e
   * "cinematografico" per l'accesso riuscito al Nexus (login/signup).
   * Più ricco del Success Chime standard: uno "sweep" ascendente di
   * filtro low-pass sotto un arpeggio di 4 note, risolto in un accordo
   * finale sostenuto a 3 voci (mai un singolo bip) — la sensazione di
   * "porte blindate che si aprono su un intero hub".
   */
  const playAccessGranted = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthAccessGranted(ctx);
  }, [ensureRunning]);

  /**
   * V26.0 — Pillar 1 (The Nexus Gate): Typing Tic — "tic" meccanico
   * impercettibile ad ogni carattere digitato nei campi email/password del
   * terminale d'accesso. Pensato per essere spammabile senza fastidio:
   * durata sub-40ms, gain bassissimo, pitch leggermente randomizzato ad
   * ogni chiamata (simula i tasti fisici di una tastiera meccanica, mai
   * lo stesso identico "tock" due volte di fila).
   */
  const playTypingTic = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthTypingTic(ctx);
  }, [ensureRunning]);

  /**
   * V27.0 — Pillar 3 (Maximum Carnage Mode): Activation Roar — thunk grave
   * distorto (waveshaper aggressivo, come il Penalty Buzzer ma molto più
   * ampio e minaccioso) seguito da un power-chord dissonante/simbionte in
   * sawtooth: il "prendere il sopravvento" del simbionte, mai un semplice
   * chime positivo (questa è furia, non una ricompensa gentile).
   */
  const playMaxCarnageActivate = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthMaxCarnageActivate(ctx);
  }, [ensureRunning]);

  /**
   * V27.0 — Pillar 3: Symbiote Drone — layer audio AMBIENTALE continuo,
   * avviato all'attivazione di Maximum Carnage e fermato esplicitamente
   * (scadenza a 2h o disattivazione). Due sawtooth gravi leggermente
   * detunate (battimento organico) filtrate in lowpass con un LFO lento
   * sulla frequenza di taglio — "respiro" simbionte a volume bassissimo,
   * pensato per restare sotto la soglia di fastidio anche per ore.
   */
  const startMaxCarnageDrone = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    if (carnageDroneRef.current) return; // già in corso: mai due drone sovrapposti
    const t0 = ctx.currentTime;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const master = ctx.createGain();

    oscA.type = 'sawtooth';
    oscA.frequency.value = 55; // A1
    oscB.type = 'sawtooth';
    oscB.frequency.value = 55.7; // detune -> battimento organico

    filter.type = 'lowpass';
    filter.frequency.value = 220;
    filter.Q.value = 2;

    lfo.type = 'sine';
    lfo.frequency.value = 0.12; // respiro lentissimo
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.045, t0 + 1.2);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(master);
    master.connect(ctx.destination);

    oscA.start(t0);
    oscB.start(t0);
    lfo.start(t0);

    carnageDroneRef.current = { oscA, oscB, lfo, master };
  }, [ensureRunning]);

  const stopMaxCarnageDrone = useCallback(() => {
    const active = carnageDroneRef.current;
    if (!active) return;
    const ctx = getAudioContext();
    if (!ctx) {
      carnageDroneRef.current = null;
      return;
    }
    const t0 = ctx.currentTime;
    active.master.gain.cancelScheduledValues(t0);
    active.master.gain.setValueAtTime(active.master.gain.value, t0);
    active.master.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    active.oscA.stop(t0 + 0.85);
    active.oscB.stop(t0 + 0.85);
    active.lfo.stop(t0 + 0.85);
    carnageDroneRef.current = null;
  }, []);

  /**
   * V27.0 — Pillar 4 (Daily Web-Sling): Web Reveal — sibilo ascendente
   * "lancio di ragnatela" (rumore filtrato + sweep), riprodotto quando il
   * forziere olografico viene rivelato, prima dell'apertura vera e propria.
   */
  const playWebSlingReveal = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthWebSlingReveal(ctx);
  }, [ensureRunning]);

  /**
   * V27.0 — Pillar 4: Chest Open — coperchio che scatta (thunk percussivo)
   * seguito da un arpeggio dorato ascendente a 5 note: la ricompensa che
   * "esplode" fuori dal forziere. Deliberatamente più festoso/luccicante
   * della Trophy Fanfare (che è epica/definitiva): qui è pura gioia rapida.
   */
  const playChestOpen = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthChestOpen(ctx);
  }, [ensureRunning]);

  /**
   * V28.1 — Pillar 3 (Spider-Sense Focus Surge): Tingling Unlock — un
   * rapido "formicolio" (oscillatore con vibrato via LFO ad alta frequenza,
   * la sensazione fisica del senso di ragno) che si risolve in un ping
   * cristallino ascendente: la ricompensa per una sessione di Focus
   * completata pulita su una Materia. Deliberatamente diverso sia dal
   * Success Chime (arpeggio morbido) sia dallo Skill Unlock (thunk +
   * arpeggio tech): qui l'identità è "percezione/allerta che si scioglie
   * in sollievo", coerente col tema Spider-Sense.
   */
  const playSpiderSenseUnlock = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthSpiderSenseUnlock(ctx);
  }, [ensureRunning]);

  /**
   * V27.0 — Pillar 2 (AI Index Matrix): Data Import — due blip digitali
   * rapidi in salita, per confermare che il parser ha validato/importato
   * la struttura incollata. Deliberatamente "informatico/pulito", mai
   * musicale come i chime di progressione: è un ACK tecnico, non un premio.
   */
  const playDataImport = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthDataImport(ctx);
  }, [ensureRunning]);

  /**
   * V34.0 — "God-Tier Pass": Delete Whoosh — riservato alle conferme
   * DISTRUTTIVE (ConfirmDialog con `danger=true`: elimina Materia, Nodo,
   * Daily Protocol, Ricompensa dello Shop...). Deliberatamente diverso da
   * ogni altro suono negativo dell'engine: il Penalty Buzzer è un ronzio
   * di "errore/penalità" mentre l'Access Denied è "porta bloccata" — qui
   * serve invece la sensazione fisica di "qualcosa che viene rimosso per
   * sempre", un breve sweep discendente filtrato (mai un ronzio, mai
   * musicale) seguito da un thud secco e cortissimo. Riproducendolo da un
   * unico punto (ConfirmDialog) copre automaticamente OGNI eliminazione
   * dell'app, senza dover instrumentare ciascuna pagina singolarmente.
   */
  const playDeleteWhoosh = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    synthDeleteWhoosh(ctx);
  }, [ensureRunning]);

  // Identità stabile fra i render: consumata come singola dipendenza
  // (`audio`) in effetti ed useMemo altrove (Context value, listener
  // globale del Web-Click) — senza questo useMemo cambierebbe riferimento
  // ad ogni render del Provider, forzando re-sottoscrizioni superflue.
  return useMemo(
    () => ({
      playWebClick,
      playSuccessChime,
      playGoblinAlert,
      playHoverBlip,
      playFocusReminder,
      playPenaltyBuzzer,
      playLevelUpChime,
      playQuestComplete,
      playTrophyFanfare,
      playSkillUnlock,
      playAccessDenied,
      playAccessGranted,
      playTypingTic,
      playMaxCarnageActivate,
      startMaxCarnageDrone,
      stopMaxCarnageDrone,
      playWebSlingReveal,
      playChestOpen,
      playDataImport,
      playSpiderSenseUnlock,
      playDeleteWhoosh
    }),
    [
      playWebClick,
      playSuccessChime,
      playGoblinAlert,
      playHoverBlip,
      playFocusReminder,
      playPenaltyBuzzer,
      playLevelUpChime,
      playQuestComplete,
      playTrophyFanfare,
      playSkillUnlock,
      playAccessDenied,
      playAccessGranted,
      playTypingTic,
      playMaxCarnageActivate,
      startMaxCarnageDrone,
      stopMaxCarnageDrone,
      playWebSlingReveal,
      playChestOpen,
      playDataImport,
      playSpiderSenseUnlock,
      playDeleteWhoosh
    ]
  );
}

export default useAudioEngine;
