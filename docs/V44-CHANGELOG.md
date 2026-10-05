# ArachnoForge V44 — Appunti con l'IA, bilancio che capisce la fase, selezione rapida

Tre interventi: una funzione nuova (**Appunti con l'IA**), il **bilancio della settimana** arricchito e consapevole della fase (lezioni o sessione), la **selezione multipla** del Web-Matrix più veloce.

---

## Prima di tutto: cosa fare una volta sola

1. **Pubblica la funzione di K.A.R.E.N. aggiornata** (appunti più lunghi letti nei quiz e nell'orale, bilancio più ricco):
   ```
   supabase functions deploy karen-oracle
   ```
   Nessun SQL da eseguire, nessun secret nuovo.
2. **Controllo completo sul PC**, poi pubblica come sempre:
   ```
   npm run check
   ```
3. **Chiudi e riapri l'app su tutti i dispositivi** (cache `af-v44-1`).

---

## 1. Appunti con l'IA — NUOVO

Scrivere a mano pagine di appunti con le formule è impossibile: ora li prepara un'IA esterna dal **tuo** materiale, nel formato che K.A.R.E.N. usa per interrogarti.

**Come si usa (Web-Matrix → Skill Tree → "Appunti con l'IA"):**
1. Scegli gli argomenti. Di partenza sono selezionati i primi 6 senza appunti: sono quanti un'IA scrive bene in una sola risposta.
2. Copia il prompt e incollalo in ChatGPT, Claude o Gemini, **allegando** il materiale di quegli argomenti (PDF, slide, pagine del libro, foto degli appunti).
3. Incolla qui la risposta. Vedi l'anteprima argomento per argomento, poi salvi.

**Il formato degli appunti** (uguale per ogni argomento): In breve · Concetti chiave · Definizioni · Formule (con il significato e l'unità di ogni simbolo) · Procedimento · Esempio svolto · Errori tipici · Domande d'esame (con la risposta attesa) · Collegamenti. Le formule sono in testo leggibile (², √, ∫, ∂, lettere greche), senza LaTeX. Se il materiale non basta, l'IA scrive [DA COMPLETARE] invece di inventare.

**Dettagli:**
- **Il prompt si adatta all'esame**: per lo scritto chiede formule, procedimenti ed esempi; per l'orale definizioni, dimostrazioni e collegamenti.
- **"Migliora i miei appunti attuali"**: l'IA riceve quello che hai già scritto, lo corregge e lo completa invece di ripartire da zero.
- **La risposta si legge anche "sporca"**: con il blocco di codice intorno, con frasi prima o dopo, con l'intestazione in grassetto. Se un codice arriva storpiato, l'argomento si riconosce dal titolo.
- **Risposta tagliata?** L'app ti dice quali argomenti mancano. Con "Seleziona i mancanti" rifai il prompt solo per quelli.
- **Appunti già presenti**: scegli se sostituirli o aggiungere sotto. Prima di sovrascrivere viene salvato un **punto di ripristino**, e per qualche secondo puoi annullare dal messaggio.
- **Dall'editor di un argomento** c'è il pulsante "Con l'IA" accanto ad Appunti: il testo va nel campo e lo salvi tu, insieme al resto.
- **Registro degli appunti**: ogni argomento ricorda quando i suoi appunti sono cambiati, quanto sono lunghi e se a mano o con l'IA. Lo usa il bilancio della settimana.

**K.A.R.E.N. legge meglio gli appunti:**
- Legge fino a **6.000 caratteri** per argomento. Prima erano 4.000 nel quiz, 2.500 nell'orale e 3.000 nella correzione.
- Usa le sezioni:
  - le **Formule** per domande di calcolo e derivazione;
  - gli **Errori tipici** per domande trappola;
  - il **Procedimento** per chiedere i passaggi;
  - i **Collegamenti** per domande di collegamento.
- Le **Domande d'esame** le indicano cosa conta, senza che le copi.
- Il quiz ha ora un secondo tentativo con più spazio se la risposta esce tagliata (prima finiva in errore e consumava la quota).

*File: `utils/aiNotes.js` e `components/AiNotesModal.jsx` (nuovi), `pages/QuadrantHub.jsx`, `state/reducer.js` (`IMPORT_NOTE_IA`, `RESTORE_NOTE_IA`, registro in `UPDATE_SFIDA`), `data/defaultSchema.js`, `context/ArachnoForgeContext.jsx`, `karen-oracle/_logic.ts`, `karen-oracle/index.ts`.*

## 2. Bilancio della settimana più ricco — consapevole della fase

Prima il bilancio guardava soprattutto a studio, ripassi ed esercizi: in una settimana di lezioni (poca roba da ripassare, molta da sistemare) sembrava una settimana "vuota". Ora riceve anche:

- **Fase della settimana** dall'orario del Campus: lezioni, sessione o mista, giorno per giorno.
- **Lezioni**: in programma, seguite, saltate; sintesi attesa (minuti di lezione × il tuo rapporto di sintesi) contro la sintesi fatta.
- **Sintesi**: pagine di fonte snellite, divise per libro, slide e dispense, e pagine dei tuoi appunti prodotte. Conta anche la sintesi registrata a mano sui nodi.
- **Appunti aggiornati**: quanti argomenti, quanti con l'IA.
- **Modi di lavoro**: minuti di sintesi, studio, ripasso, esercizi e simulazioni.
- **Qualità del focus** (flow, normale, distratto), **argomenti chiusi**, **interrogazioni** (domande sapute, parziali, no).

**K.A.R.E.N. giudica la settimana secondo la sua fase.** In lezioni il metro sono le lezioni sistemate, le pagine e gli appunti, e pochi ripassi non sono un difetto. In sessione contano studio, ripassi, esercizi e simulazioni contro gli esami in arrivo.

**Nella scheda** le tessere si adattano alla fase:
- **Settimana di lezioni**: Studio · Lezioni · Pagine snellite · Appunti aggiornati · Ripassi · Giornate chiuse.
- **Settimana di sessione**: Studio · Ripassi · Esercizi · Pagine snellite · Appunti aggiornati · Giornate chiuse.

Un'etichetta dice quale fase sta guardando.

*File: `services/karenEngine/weeklyContext.js`, `components/WeeklyReviewCard.jsx`, `karen-oracle/_logic.ts` (`sanitizeWeeklyWork`, prompt del bilancio).*

## 3. Web-Matrix: seleziona tutto ed elimina

- **"Seleziona tutto"** nella barra della selezione (e "Deseleziona tutto").
- **Un capitolo porta con sé i suoi sotto-argomenti**: toccare un argomento con figli seleziona (o deseleziona) anche tutto quello che ha sotto. Puoi sempre togliere a mano un singolo sotto-argomento.
- Eliminando **5 o più argomenti** viene salvato prima un **punto di ripristino** (Impostazioni → Backup), oltre all'"Annulla" del messaggio. Il titolo della conferma dice quando stai eliminando tutto lo Skill Tree.

*File: `pages/QuadrantHub.jsx`, `context/ArachnoForgeContext.jsx`, `utils/localBackups.js`.*

---

## Verifiche

- `src/utils/v44.test.js`: 12 test nuovi.
  - Appunti: codici, prompt, lettura della risposta, unione, registro, annullamento, conservazione al ricaricamento.
  - Bilancio: settimana di lezioni con orario, esiti e sintesi a mano, e settimana senza orario.
- `karen-oracle/_logic.test.ts`: 3 test nuovi. Un test esistente è aggiornato al nuovo tetto degli appunti (6.000).
- Tutti i test passano, anche con il fuso orario `Europe/Rome`.
- Versione 44.0.0, cache del service worker `af-v44-1`.
