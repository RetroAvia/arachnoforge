// =====================================================================
// ArachnoForge — src/hooks/audio-engine/sounds.js
// V35.2 — "Disaccoppiamento Meccanico useAudioEngine". Estratto VERBATIM
// dai corpi dei singoli play*() di useAudioEngine.js: ogni funzione qui
// e' pura rispetto all'AudioContext (stesso input `ctx` -> stessa identica
// sequenza di nodi Web Audio creata/collegata/avviata, zero stato interno
// all'hook, zero dipendenza da enabledRef/ensureRunning). useAudioEngine.js
// resta l'UNICO file che possiede il flag "enabled", il debounce via ref e
// lo stato del drone Maximum Carnage (che per questo resta nell'hook,
// non qui) — chiama semplicemente queste funzioni dopo aver superato le
// proprie guardie (enabled? contesto disponibile? contesto ripreso da
// sospensione?). Nessuna costante numerica (frequenze, tempi di
// inviluppo, gain) e' stata ritoccata in questa estrazione — solo
// spostata e reindentata. Vedi docs/PHASE5_REFACTOR.md.
// =====================================================================

/** Web-Click — blip breve e ovattato per i pulsanti primari, in tutta l'app. */
export function synthWebClick(ctx) {
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
}

/** Success Chime — arpeggio ascendente gentile per nodi/quest completati. */
export function synthSuccessChime(ctx) {
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
}

/** Hover Blip — micro-click discreto per i bottoni principali al passaggio del mouse. */
export function synthHoverBlip(ctx) {
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
}

/** Focus Reminder — rintocco tibetano ogni 30 minuti di Focus ininterrotto. */
export function synthFocusReminder(ctx) {
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
}

/** Penalty Buzzer — ronzio distorto e grave per la Boss Fight quando si sbircia una soluzione. */
export function synthPenaltyBuzzer(ctx) {
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
}

/** Level Up Chime — arpeggio eroico per Supercriminali sconfitti o Nodo Padre completato. */
export function synthLevelUpChime(ctx) {
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
}

/** Goblin Alert — ronzio grave e ansiogeno (low-pass) per la fase Enrage. */
export function synthGoblinAlert(ctx) {
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
}

/** Quest Complete — triade arcade per il completamento di una missione della Daily Patrol. */
export function synthQuestComplete(ctx) {
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
}

/** Trophy Fanfare — arpeggio esteso a 7 note per i trofei di Tier Multiverse. */
export function synthTrophyFanfare(ctx) {
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
}

/** Skill Unlock — thunk meccanico + arpeggio tech randomizzato per lo sblocco di un'abilità. */
export function synthSkillUnlock(ctx) {
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
}

/** Access Denied — ronzio grave a doppio impulso dissonante per errori di autenticazione. */
export function synthAccessDenied(ctx) {
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
}

/** Access Granted — chime epico/cinematografico per l'accesso riuscito al Nexus. */
export function synthAccessGranted(ctx) {
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
}

/** Typing Tic — tic meccanico impercettibile ad ogni carattere digitato nel terminale d'accesso. */
export function synthTypingTic(ctx) {
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
}

/** Maximum Carnage — Activation Roar: thunk distorto + power-chord dissonante. */
export function synthMaxCarnageActivate(ctx) {
  const t0 = ctx.currentTime;

  const roarOsc = ctx.createOscillator();
  const shaper = ctx.createWaveShaper();
  const roarFilter = ctx.createBiquadFilter();
  const roarGain = ctx.createGain();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const x = (i / 255) * 2 - 1;
    curve[i] = Math.tanh(x * 9);
  }
  shaper.curve = curve;
  roarFilter.type = 'lowpass';
  roarFilter.frequency.setValueAtTime(1200, t0);
  roarFilter.frequency.exponentialRampToValueAtTime(90, t0 + 0.7);
  roarOsc.type = 'sawtooth';
  roarOsc.frequency.setValueAtTime(70, t0);
  roarOsc.frequency.exponentialRampToValueAtTime(38, t0 + 0.7);
  roarGain.gain.setValueAtTime(0.0001, t0);
  roarGain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.04);
  roarGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
  roarOsc.connect(shaper);
  shaper.connect(roarFilter);
  roarFilter.connect(roarGain);
  roarGain.connect(ctx.destination);
  roarOsc.start(t0);
  roarOsc.stop(t0 + 0.9);

  // Power-chord dissonante (tritono, mai un accordo "gradevole"): tre
  // sawtooth ravvicinate che sfumano dentro alla coda del ruggito.
  const chordStart = t0 + 0.35;
  const master = ctx.createGain();
  master.gain.value = 0.11;
  master.connect(ctx.destination);
  [110, 155.56, 220].forEach((freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, chordStart);
    gain.gain.exponentialRampToValueAtTime(1, chordStart + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, chordStart + 0.9);
    osc.connect(gain);
    gain.connect(master);
    osc.start(chordStart);
    osc.stop(chordStart + 0.95);
  });
}

/** Web Reveal — sibilo ascendente di lancio di ragnatela per il forziere olografico. */
export function synthWebSlingReveal(ctx) {
  const t0 = ctx.currentTime;

  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = 'bandpass';
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(500, t0);
  filter.frequency.exponentialRampToValueAtTime(3800, t0 + 0.32);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, t0);
  osc.frequency.exponentialRampToValueAtTime(1400, t0 + 0.32);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.4);
}

/** Chest Open — coperchio che scatta seguito da un arpeggio dorato ascendente a 5 note. */
export function synthChestOpen(ctx) {
  const t0 = ctx.currentTime;

  const lidOsc = ctx.createOscillator();
  const lidGain = ctx.createGain();
  lidOsc.type = 'square';
  lidOsc.frequency.setValueAtTime(180, t0);
  lidOsc.frequency.exponentialRampToValueAtTime(70, t0 + 0.08);
  lidGain.gain.setValueAtTime(0.0001, t0);
  lidGain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.012);
  lidGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  lidOsc.connect(lidGain);
  lidGain.connect(ctx.destination);
  lidOsc.start(t0);
  lidOsc.stop(t0 + 0.13);

  const notes = [659.25, 830.61, 987.77, 1244.5, 1567.98]; // E5-Ab5-B5-Eb6-Gb6, arpeggio luccicante
  const master = ctx.createGain();
  master.gain.value = 0.14;
  master.connect(ctx.destination);
  notes.forEach((freq, i) => {
    const start = t0 + 0.1 + i * 0.06;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(1, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.32);
  });
}

/** Spider-Sense Focus Surge — formicolio + ping cristallino per una sessione di Focus pulita. */
export function synthSpiderSenseUnlock(ctx) {
  const t0 = ctx.currentTime;

  // Formicolio — oscillatore vibrato rapido (LFO ~28Hz sulla frequenza),
  // gain basso e breve: il "tingle" prima dello sblocco.
  const tingleOsc = ctx.createOscillator();
  const tingleGain = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  tingleOsc.type = 'sine';
  tingleOsc.frequency.setValueAtTime(1100, t0);
  lfo.type = 'sine';
  lfo.frequency.value = 28;
  lfoGain.gain.value = 70;
  lfo.connect(lfoGain);
  lfoGain.connect(tingleOsc.frequency);
  tingleGain.gain.setValueAtTime(0.0001, t0);
  tingleGain.gain.exponentialRampToValueAtTime(0.07, t0 + 0.03);
  tingleGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
  tingleOsc.connect(tingleGain);
  tingleGain.connect(ctx.destination);
  lfo.start(t0);
  tingleOsc.start(t0);
  lfo.stop(t0 + 0.34);
  tingleOsc.stop(t0 + 0.34);

  // Risoluzione — ping cristallino a due note ascendenti.
  const master = ctx.createGain();
  master.gain.value = 0.15;
  master.connect(ctx.destination);
  [1318.5, 1760.0].forEach((freq, i) => { // E6 - A6
    const start = t0 + 0.3 + i * 0.1;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(1, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.42);
  });
}

/** Data Import — due blip digitali rapidi in salita per l'AI Index Matrix. */
export function synthDataImport(ctx) {
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.12;
  master.connect(ctx.destination);
  [880, 1318.5].forEach((freq, i) => {
    const start = t0 + i * 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.12);
  });
}

/** Delete Whoosh — sweep discendente + thud secco per le conferme distruttive. */
export function synthDeleteWhoosh(ctx) {
  const t0 = ctx.currentTime;

  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  filter.type = 'bandpass';
  filter.Q.value = 4;
  filter.frequency.setValueAtTime(2200, t0);
  filter.frequency.exponentialRampToValueAtTime(180, t0 + 0.16);

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(900, t0);
  osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.16);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.1, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.2);

  // Thud secco di chiusura, subito dopo lo sweep — la "porta" che si
  // richiude sul contenuto appena rimosso.
  const thudOsc = ctx.createOscillator();
  const thudGain = ctx.createGain();
  const thudStart = t0 + 0.14;
  thudOsc.type = 'sine';
  thudOsc.frequency.setValueAtTime(120, thudStart);
  thudOsc.frequency.exponentialRampToValueAtTime(45, thudStart + 0.09);
  thudGain.gain.setValueAtTime(0.0001, thudStart);
  thudGain.gain.exponentialRampToValueAtTime(0.22, thudStart + 0.01);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, thudStart + 0.11);
  thudOsc.connect(thudGain);
  thudGain.connect(ctx.destination);
  thudOsc.start(thudStart);
  thudOsc.stop(thudStart + 0.12);
}

/**
 * V40.3 — Block Complete: il suono che mancava, cioè quello che conta di
 * più in un'app col timer. Tre rintocchi in salita (C5–G5–C6) con una
 * coda lunga: si sente dall'altra parte della stanza, non assomiglia a
 * nessun altro suono dell'app e non è aggressivo. Prima la fine di un
 * blocco era muta: l'unico segnale era la notifica di sistema, che però
 * è spenta finché non la si attiva a mano.
 */
export function synthBlockComplete(ctx, at = null) {
  const t0 = at != null ? Math.max(at, ctx.currentTime) : ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  const oscillatori = [];

  [523.25, 783.99, 1046.5].forEach((freq, i) => {
    const start = t0 + i * 0.16;
    // Campana: fondamentale + ottava sopra a volume basso.
    [
      { f: freq, vol: 1 },
      { f: freq * 2, vol: 0.28 }
    ].forEach(({ f, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(vol, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.5);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 1.55);
      oscillatori.push(osc);
    });
  });
  return oscillatori;
}

/**
 * V40.3 — Break Over: due note discendenti, più brevi e discrete del
 * Block Complete. "La pausa è finita", non "hai vinto qualcosa".
 */
export function synthBreakOver(ctx, at = null) {
  const t0 = at != null ? Math.max(at, ctx.currentTime) : ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(ctx.destination);
  const oscillatori = [];

  [783.99, 523.25].forEach((freq, i) => {
    const start = t0 + i * 0.14;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(1, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.65);
    oscillatori.push(osc);
  });
  return oscillatori;
}
