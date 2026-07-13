import { useRef, useCallback, useEffect, useMemo } from 'react';

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

  /** Web-Click — blip breve e ovattato per i pulsanti primari, in tutta l'app. */
  const playWebClick = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.Q.value = 0.7;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, t0);
    osc.frequency.exponentialRampToValueAtTime(360, t0 + 0.055);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.085);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  }, [ensureRunning]);

  /** Success Chime — arpeggio ascendente gentile per nodi/quest completati. */
  const playSuccessChime = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    const t0 = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 - E5 - G5 - C6
    const master = ctx.createGain();
    master.gain.value = 0.13;
    master.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const start = t0 + i * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(1, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.36);
    });
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
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, t0);
    osc.frequency.exponentialRampToValueAtTime(3100, t0 + 0.02);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.045, t0 + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.04);
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
    const t0 = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0.1;
    master.connect(ctx.destination);

    [523.25, 261.63].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.05;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(1, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.4);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 2.5);
    });
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
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    const shaper = ctx.createWaveShaper();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    shaper.curve = curve;

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t0);
    filter.frequency.exponentialRampToValueAtTime(140, t0 + 0.4);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.4);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);

    osc.connect(shaper);
    shaper.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.5);
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
    const t0 = ctx.currentTime;

    const notes = [392.0, 523.25, 659.25, 783.99, 1046.5]; // G4 - C5 - E5 - G5 - C6
    const master = ctx.createGain();
    master.gain.value = 0.15;
    master.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const start = t0 + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === notes.length - 1 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(i === notes.length - 1 ? 1.3 : 1, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (i === notes.length - 1 ? 0.6 : 0.32));
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + (i === notes.length - 1 ? 0.65 : 0.36));
    });
  }, [ensureRunning]);

  /** Goblin Alert — ronzio grave e ansiogeno (low-pass) per la fase Enrage. */
  const playGoblinAlert = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    ensureRunning(ctx);
    const t0 = ctx.currentTime;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, t0);
    filter.frequency.exponentialRampToValueAtTime(220, t0 + 1.4);
    filter.Q.value = 3;

    oscA.type = 'sawtooth';
    oscA.frequency.setValueAtTime(68, t0);
    oscB.type = 'sawtooth';
    oscB.frequency.setValueAtTime(69.4, t0); // leggero detune -> battimento ansiogeno

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.7);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    oscA.start(t0);
    oscB.start(t0);
    oscA.stop(t0 + 1.75);
    oscB.stop(t0 + 1.75);
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
    const t0 = ctx.currentTime;

    const notes = [659.25, 880.0, 1318.5]; // E5 - A5 - E6
    const master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const start = t0 + i * 0.06;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.55, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.24);
    });
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
    const t0 = ctx.currentTime;

    const notes = [392.0, 493.88, 587.33, 659.25, 783.99, 987.77, 1174.7]; // G4 - B4 - D5 - E5 - G5 - B5 - D6
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const isFinale = i >= notes.length - 2;
      const start = t0 + i * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isFinale ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(isFinale ? 1.4 : 1, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (isFinale ? 0.7 : 0.3));
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + (isFinale ? 0.75 : 0.34));
    });
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
    const t0 = ctx.currentTime;

    // Thunk meccanico d'apertura — grave, cortissimo, percussivo: la
    // sensazione fisica di un "lock" che scatta prima dell'arpeggio.
    const thunkOsc = ctx.createOscillator();
    const thunkGain = ctx.createGain();
    thunkOsc.type = 'square';
    thunkOsc.frequency.setValueAtTime(90, t0);
    thunkOsc.frequency.exponentialRampToValueAtTime(150, t0 + 0.06);
    thunkGain.gain.setValueAtTime(0.0001, t0);
    thunkGain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01);
    thunkGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    thunkOsc.connect(thunkGain);
    thunkGain.connect(ctx.destination);
    thunkOsc.start(t0);
    thunkOsc.stop(t0 + 0.1);

    // Root pitch casuale fra 3 varianti (±1 semitono, ~5.9%) + set di
    // intervalli "tech" (pentatonica maggiore, sempre gradevole in
    // qualunque ordine) — la combinazione rende ogni sblocco leggermente
    // diverso dal precedente senza mai suonare stonato.
    const rootVariants = [1, 1.0595, 0.9439];
    const rootMultiplier = rootVariants[Math.floor(Math.random() * rootVariants.length)];
    const baseNotes = [523.25, 659.25, 783.99, 987.77, 1174.66]; // C5 - E5 - G5 - B5 - D6
    const waveforms = Math.random() > 0.5 ? ['square', 'triangle'] : ['triangle', 'square'];

    const master = ctx.createGain();
    master.gain.value = 0.14;
    master.connect(ctx.destination);

    const arpStart = t0 + 0.08;
    baseNotes.forEach((freq, i) => {
      const jitter = 1 + (Math.random() - 0.5) * 0.015; // +/-0.75% di jitter di intonazione
      const start = arpStart + i * (0.07 + Math.random() * 0.01);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = waveforms[i % 2];
      osc.frequency.value = freq * rootMultiplier * jitter;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(i === baseNotes.length - 1 ? 1.1 : 0.85, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (i === baseNotes.length - 1 ? 0.42 : 0.2));
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + (i === baseNotes.length - 1 ? 0.46 : 0.24));
    });
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
    const t0 = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    [0, 0.16].forEach((offset) => {
      const start = t0 + offset;
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, start);
      filter.frequency.exponentialRampToValueAtTime(160, start + 0.18);

      oscA.type = 'square';
      oscA.frequency.setValueAtTime(146, start);
      oscB.type = 'square';
      oscB.frequency.setValueAtTime(138, start); // detune -> battimento "errore"

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.5, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      oscA.start(start);
      oscB.start(start);
      oscA.stop(start + 0.22);
      oscB.stop(start + 0.22);
    });
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
    const t0 = ctx.currentTime;

    // Sweep di filtro sotto un pad continuo: la "porta che si apre".
    const sweepOsc = ctx.createOscillator();
    const sweepFilter = ctx.createBiquadFilter();
    const sweepGain = ctx.createGain();
    sweepOsc.type = 'sawtooth';
    sweepOsc.frequency.value = 130.81; // C3
    sweepFilter.type = 'lowpass';
    sweepFilter.Q.value = 4;
    sweepFilter.frequency.setValueAtTime(200, t0);
    sweepFilter.frequency.exponentialRampToValueAtTime(3200, t0 + 0.5);
    sweepGain.gain.setValueAtTime(0.0001, t0);
    sweepGain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.3);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    sweepOsc.connect(sweepFilter);
    sweepFilter.connect(sweepGain);
    sweepGain.connect(ctx.destination);
    sweepOsc.start(t0);
    sweepOsc.stop(t0 + 0.95);

    // Arpeggio ascendente (4 note) seguito da un accordo finale a 3 voci.
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 - E5 - G5 - C6
    const master = ctx.createGain();
    master.gain.value = 0.15;
    master.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const start = t0 + 0.1 + i * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(1, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.34);
    });

    const chordStart = t0 + 0.1 + notes.length * 0.085 + 0.05;
    [1046.5, 1318.5, 1568.0].forEach((freq) => { // C6 - E6 - G6
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, chordStart);
      gain.gain.exponentialRampToValueAtTime(0.9, chordStart + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, chordStart + 0.9);
      osc.connect(gain);
      gain.connect(master);
      osc.start(chordStart);
      osc.stop(chordStart + 0.95);
    });
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
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const baseFreq = 1600 + Math.random() * 900;

    osc.type = 'square';
    osc.frequency.setValueAtTime(baseFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.6, t0 + 0.018);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.035, t0 + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.035);
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
      playTypingTic
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
      playTypingTic
    ]
  );
}

export default useAudioEngine;
