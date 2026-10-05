# ArachnoForge V43 — Il piano dice il vero, K.A.R.E.N. impara cosa funziona

Otto interventi mirati sulla V42: quattro correzioni del piano di studio, due di affidabilità, la Stamina ribilanciata e una funzione nuova, la **memoria delle tecniche**. Nessuna pagina rimossa, nessun dato da migrare a mano.

---

## Prima di tutto: cosa fare una volta sola

1. **Pubblica la funzione di K.A.R.E.N. aggiornata** (serve per la memoria delle tecniche):
   ```
   supabase functions deploy karen-oracle
   ```
   Nessuna nuova tabella né secret: niente SQL da eseguire.
2. **Controllo completo sul PC**, poi pubblica come sempre (Vercel):
   ```
   npm run check
   ```
3. **Aggiorna tutti i dispositivi** (telefono compreso): chiudi e riapri l'app installata. Una versione vecchia rimasta aperta non conosce il campo nuovo delle tecniche e, salvando, lo perderebbe.

---

## 1. Materia congelata per errore — corretto

Una propedeutica con l'appello **già sostenuto ma il voto non ancora registrato** congelava a 0 ore la materia che la richiede (es. Analisi 2 ferma mentre aspetti l'esito di Analisi 1), e le ore andavano all'esame già fatto.
Ora l'esame sostenuto conta come "in programma prima": la materia successiva entra nel piano. Resta bloccata solo se dichiari l'appello **non superato** o se la propedeutica non ha una data. In Oggi compare "sostenuta il …, esito in attesa".
*File: `data/vanvitelliCourseMap.js`, `utils/studyPlanner.js`, `components/mission/TodayPanel.jsx`.*

## 2. Ripassi dopo mezzanotte — corretto

Le date dei ripassi si leggevano in UTC: un ripasso alle 00:30 finiva sul giorno prima (memoria stimata gonfiata, "ripassi di oggi" sbagliati, XP potenzialmente doppi). Ora ogni istante salvato si legge nel **giorno locale**, anche per i dati già esistenti.
*File: `utils/dateUtils.js` (`localDateKeyOf`), `utils/spiderSense.js`, `utils/studyPlanner.js`, `utils/examReadiness.js`, `services/karenEngine/weeklyContext.js`.*

## 3. Ripassi arretrati che sparivano dal piano — corretto

I ripassi oltre la metà della giornata "scivolavano ai prossimi giorni" solo a parole: domani riceveva comunque la capacità piena di studio nuovo. Ora l'arretrato occupa davvero i giorni successivi (al massimo metà di ciascuno) finché non è smaltito, e fine prevista e stato di ogni materia ne tengono conto. In Oggi: "N rinviati nei prossimi X giorni".
*File: `utils/studyPlanner.js`.*

## 4. Scenario "un'ora in più al giorno" — corretto

Lo scenario sostituiva tutto il profilo (giorni della settimana, lezioni, riposi spalmati): il guadagno vero poteva essere +0,5 h o +1,7 h. Ora aggiunge **esattamente un'ora a ogni giorno di studio**, sopra il profilo vero (`bonusHours`).
*File: `utils/calibration.js`, `utils/planScenarios.js`.*

## 5. L'IA leggeva appunti non ancora salvati — corretto

Prima di ogni chiamata a K.A.R.E.N. (briefing, quiz, orale, valutazione, bilancio) l'app **salva subito** il lavoro in attesa sul Cloud, al massimo 8 secondi di attesa. Prima, scrivendo gli appunti e premendo subito "Prepara le domande", K.A.R.E.N. leggeva la versione vecchia.
*File: `utils/aiSaveGuard.js` (nuovo), `services/karenEngine/useSuitTelemetry.js`, `context/ArachnoForgeContext.jsx`.*

## 6. Doppio suono di fine blocco su mobile — corretto

Con lo schermo bloccato (iOS) il suono programmato restava in coda e risuonava più tardi, a volte durante la pausa. Ora, se non è suonato in tempo, viene annullato prima di suonare una volta sola.
*File: `hooks/useFocusTimer.js`.*

## 7. Memoria delle tecniche — NUOVO

- **Nel Debriefing** di fine sessione, su un argomento preciso, scegli con un tocco la tecnica che hai usato (Richiamo attivo, Feynman, Esempi svolti, Esercizi, Interleaving, Elaborazione, Schema a domande, Codifica duale, Mappa concettuale, Rilettura). Se K.A.R.E.N. ne aveva consigliata una per quell'argomento, è già selezionata. È facoltativo.
- **L'app misura cosa funziona:** ogni ripasso, interrogazione o serie di esercizi successivi su quell'argomento conta per la tecnica prevalente usata lì. Buono = ripasso "Bene"/"Facile", interrogazione o esercizi al 60% o più.
- **Daily Bugle Archives → "Le tue tecniche":** minuti, sessioni e percentuale di esiti buoni per tecnica e per materia (la percentuale compare da 3 esiti in su).
- **K.A.R.E.N. la usa:** briefing e bilancio settimanale ricevono questa memoria. Privilegia ciò che con te ha funzionato su quella materia, non ripropone uguale ciò che non funziona, e lo dice con i numeri. Il briefing ora restituisce anche il codice della tecnica consigliata.

*File: `data/studyTechniques.js` (nuovo), `utils/techniqueMemory.js` (nuovo), `components/DebriefModal.jsx`, `pages/MissionControl.jsx`, `pages/StarLog.jsx`, `state/reducer.js`, `data/defaultSchema.js`, `services/karenEngine/planContext.js`, `services/karenEngine/weeklyContext.js`, `components/WeeklyReviewCard.jsx`, `supabase/functions/karen-oracle/_logic.ts`.*

## 8. Stamina mentale ribilanciata e collegata alla Suit Telemetry

**Il problema:** la riserva di Stamina era tarata sulla capacità *media* del planner, cioè le ore di studio divise per tutti i giorni del mese, compresi quelli a zero. Con qualche giorno saltato la media scendeva a 1–1,5 h e 2 ore di Focus azzeravano la Stamina (con 1,2 h di media: 132 punti consumati in 2 ore).

**Ora:**
- la riserva vale **almeno 4h30** di Focus (la giornata tipo) e al massimo 9 ore; se studi abitualmente di più, cresce con te. 2 ore di Focus a difficoltà media costano circa 36 punti (prima delle pause, che ricaricano come prima);
- **la Readiness di oggi della Suit Telemetry regola il consumo:** readiness 100 → −15%, intorno a 75 → normale, 45 → +10%, 0 → +30%. Senza una readiness misurata oggi, nessun effetto. La barra della Stamina mostra l'effetto di oggi ("consumo di Stamina −12%").

*File: `utils/xpEngine.js`, `state/reducer.js`, `context/ArachnoForgeContext.jsx`, `pages/MissionControl.jsx`, `components/StaminaBar.jsx`.*

---

## Verifiche

- `src/utils/v43.test.js`: 19 test nuovi, uno o più per ogni intervento. Quelli dei punti 1, 2, 3, 4 e 8 falliscono sulla V42 e passano sulla V43.
- Tutti i test esistenti passano, anche con il fuso orario `Europe/Rome`.
- `karen-oracle/_logic.test.ts`: 5 test nuovi (memoria delle tecniche, codice della tecnica), tutti i 98 precedenti invariati.
- Versione 43.0.0, cache del service worker `af-v43-1` (l'app installata scarica il codice nuovo).
