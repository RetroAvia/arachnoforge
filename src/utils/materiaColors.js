/* ------------------------------------------------------------------ *
 * ArachnoForge — src/utils/materiaColors.js
 * COLORI DELLE MATERIE (V42: condivisi fra Campus e Piano della sessione)
 * Stabili per id (non per posizione in lista): aggiungere o togliere una
 * materia non ricolora le altre. Classi letterali, così Tailwind le
 * include nel CSS (tailwind.config deve leggere anche src/utils).
 * ------------------------------------------------------------------ */
export const PALETTE = [
  { bar: 'bg-cyan-400', block: 'bg-cyan-400/[0.10] border-cyan-400/35 hover:bg-cyan-400/[0.16]', text: 'text-cyan-50', dot: 'bg-cyan-400' },
  { bar: 'bg-violet-400', block: 'bg-violet-400/[0.10] border-violet-400/35 hover:bg-violet-400/[0.16]', text: 'text-violet-50', dot: 'bg-violet-400' },
  { bar: 'bg-amber-400', block: 'bg-amber-400/[0.10] border-amber-400/35 hover:bg-amber-400/[0.16]', text: 'text-amber-50', dot: 'bg-amber-400' },
  { bar: 'bg-emerald-400', block: 'bg-emerald-400/[0.10] border-emerald-400/35 hover:bg-emerald-400/[0.16]', text: 'text-emerald-50', dot: 'bg-emerald-400' },
  { bar: 'bg-rose-400', block: 'bg-rose-400/[0.10] border-rose-400/35 hover:bg-rose-400/[0.16]', text: 'text-rose-50', dot: 'bg-rose-400' },
  { bar: 'bg-sky-400', block: 'bg-sky-400/[0.10] border-sky-400/35 hover:bg-sky-400/[0.16]', text: 'text-sky-50', dot: 'bg-sky-400' },
  { bar: 'bg-lime-400', block: 'bg-lime-400/[0.10] border-lime-400/35 hover:bg-lime-400/[0.16]', text: 'text-lime-50', dot: 'bg-lime-400' },
  { bar: 'bg-fuchsia-400', block: 'bg-fuchsia-400/[0.10] border-fuchsia-400/35 hover:bg-fuchsia-400/[0.16]', text: 'text-fuchsia-50', dot: 'bg-fuchsia-400' }
];

export function colorFor(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
