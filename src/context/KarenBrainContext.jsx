import React, { createContext, useContext, useMemo } from 'react';
import { useSuitTelemetry } from '../services/karenEngine/useSuitTelemetry.js';

/**
 * V35.0 — K.A.R.E.N. "Daily Brain": Provider condiviso attorno a
 * useSuitTelemetry.js.
 *
 * Prima di questa modifica, `useSuitTelemetry` veniva montato DUE VOLTE
 * in modo indipendente (MissionControl.jsx e SuitTelemetryView.jsx) —
 * due fetch separati verso le stesse 3 tabelle, nessuna garanzia che le
 * due pagine mostrassero lo stesso `briefing` nello stesso istante. Ora
 * un solo Provider, montato in App.jsx come ANTENATO di
 * ArachnoForgeProvider, cosi' anche il Cloud State (che deve leggere
 * `directives.focus_timer` per il Focus Timer Adattivo, vedi
 * ArachnoForgeContext.jsx) può consumarlo.
 *
 * COMPARTIMENTI STAGNI preservati: questo Provider non importa né viene
 * importato da ArachnoForgeContext.jsx a livello di modulo — la
 * dipendenza è unidirezionale (ArachnoForgeContext consuma
 * useKarenBrain, mai il contrario) e resta comunque isolata a livello di
 * STORAGE — nessuna tabella biometrica viene toccata da qui, nessun
 * campo di `user_data` viene letto da qui. L'unico bridge dati verso il
 * Cloud State è esplicito e a senso unico (vedi KarenTrophyBridge in
 * App.jsx, che dispatcha LOG_READINESS_SNAPSHOT).
 *
 * `directives` è il payload esteso (Fase 4, "Daily Brain") generato
 * dalla STESSA, unica chiamata Claude giornaliera di karen-oracle —
 * `{ mission_control, focus_timer, study_window }` — derivato qui una
 * sola volta da `briefing?.directives`, mai ricalcolato lato client.
 */
const KarenBrainContext = createContext(null);

export function KarenBrainProvider({ children }) {
  const telemetry = useSuitTelemetry();

  const directives = telemetry.briefing && telemetry.briefing.directives && typeof telemetry.briefing.directives === 'object'
    ? telemetry.briefing.directives
    : null;

  const value = useMemo(
    () => ({
      ...telemetry,
      directives
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [telemetry, directives]
  );

  return <KarenBrainContext.Provider value={value}>{children}</KarenBrainContext.Provider>;
}

export function useKarenBrain() {
  const ctx = useContext(KarenBrainContext);
  if (!ctx) throw new Error('useKarenBrain deve essere usato dentro <KarenBrainProvider>.');
  return ctx;
}

export default KarenBrainContext;
