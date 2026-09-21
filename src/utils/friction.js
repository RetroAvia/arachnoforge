/**
 * Friction Analytics: Frizione = (Fallimenti / (Successi + Fallimenti)) * 100
 * Ritorna 0 quando non ci sono ancora tentativi, per evitare NaN.
 */
export function computeFriction(tentativiSuccessi = 0, tentativiFalliti = 0) {
  const totale = tentativiSuccessi + tentativiFalliti;
  if (totale === 0) return 0;
  return Math.round((tentativiFalliti / totale) * 1000) / 10;
}

export const BOUNTY_FRICTION_THRESHOLD = 60;

export function isBountyTarget(sfida) {
  return computeFriction(sfida.tentativiSuccessi, sfida.tentativiFalliti) > BOUNTY_FRICTION_THRESHOLD;
}
