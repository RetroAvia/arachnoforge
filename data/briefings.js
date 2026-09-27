/**
 * Daily Briefing — citazioni originali a rotazione, tema Ingegneria
 * Aerospaziale / Spazio / Resilienza. Nessuna attribuita a persone reali:
 * sono epigrafi originali in stile "log di missione".
 */
export const BRIEFINGS = [
  'Ogni traiettoria orbitale comincia con un singolo delta-v calcolato correttamente.',
  'La resistenza dei materiali non perdona l\'approssimazione. Nemmeno la tua preparazione.',
  'Il margine di sicurezza non è debolezza: è ciò che ti riporta a casa.',
  'Un motore non decide di accendersi bene. È progettato per farlo, ripetutamente.',
  'La finestra di lancio non aspetta chi non è pronto.',
  'Ogni sistema ridondante esiste perché qualcuno, prima, ha studiato il fallimento.',
  'Lo spazio non concede seconde possibilità in tempo reale: solo in fase di progetto.',
  'La turbolenza si attraversa, non si evita: mantieni la rotta.',
  'Un ingegnere non spera che il sistema regga. Lo dimostra.',
  'La checklist non è burocrazia: è memoria esterna quando la pressione sale.',
  'Il rientro atmosferico comincia molto prima di toccare l\'atmosfera.',
  'La precisione non è innata. È l\'unica cosa che si allena ogni singolo giorno.',
  'Nessuna missione fallisce per un singolo errore: fallisce per un errore non intercettato.',
  'Il carburante che non hai calcolato è il primo che ti mancherà.',
  'La stabilità di un sistema si misura da come reagisce, non da quanto raramente vacilla.'
];

export function getBriefingForToday() {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return BRIEFINGS[dayOfYear % BRIEFINGS.length];
}
