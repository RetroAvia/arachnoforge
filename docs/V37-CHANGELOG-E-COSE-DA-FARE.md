# ArachnoForge V37.0 — "Hardening Pass"

Changelog completo dell'intervento + **cose che devi fare tu a mano**
(le uniche che io non posso fare da qui).

---

## ⚠️ PARTE 1 — DA FARE SUBITO, IN QUEST'ORDINE

### 1. Sblocca Git (30 secondi)

Sul PC esiste un file bloccante lasciato da un'operazione Git interrotta:

```
C:\a\arachnoforge-build\.git\index.lock
```

Finché c'è, **ogni comando git fallisce** con
`fatal: Unable to create '...index.lock': File exists`. Cancellalo a mano
da Esplora Risorse (o `del .git\index.lock` nel terminale). Non posso
cancellare file io: lo strumento che avrei per farlo non riesce a montare
le cartelle su Windows da dopo l'aggiornamento dell'8 settembre.

Nella cartella c'è anche un `_to_delete\` da una sessione precedente:
controlla che dentro non ci sia niente che ti serve e buttalo.

### 2. Cambia la password `Spazioaereo10!`

**Questo è il punto più importante di tutto il documento.**

In `src/utils/adminOverride.js` la passphrase admin era scritta
**in chiaro nel codice sorgente**, che Vite impacchetta e serve al
browser: chiunque aprisse DevTools sul sito pubblico poteva leggerla in
tre secondi. È su GitHub, quindi è anche nella cronologia dei commit.

Ora legge `VITE_ADMIN_PASSPHRASE`, ma **se quella password la usi da
qualche altra parte — mail, banca, università, Supabase — cambiala lì,
adesso.** Va considerata compromessa a prescindere.

### 3. Chiudi le iscrizioni pubbliche su Supabase

L'app è a uso singolo ma il progetto Supabase accetta registrazioni da
chiunque. Ogni account creato da un estraneo può chiamare la tua Edge
Function `karen-oracle` e **consumare il tuo budget Anthropic**.

Supabase → **Authentication → Providers → Email** → disattiva
*"Allow new users to sign up"*.

### 4. Esegui le due nuove migrazioni SQL

Supabase → **SQL Editor** → incolla ed esegui, in quest'ordine:

1. `supabase/user_data_v6_optimistic_locking.sql`
   Aggiunge `updated_at` + trigger a `user_data`. Senza, il rilevamento
   dei conflitti multi-dispositivo si autodisattiva in silenzio (l'app
   continua a funzionare, ma torna a poter sovrascrivere).
2. `supabase/karen_ai_usage_v7_quiz_rate_limit.sql`
   Tabella `karen_ai_usage` + RPC `bump_karen_quiz_usage`. Senza, il
   tetto di 30 generazioni di quiz al giorno non viene applicato.

### 5. Variabili d'ambiente

Copia `.env.example` in `.env.local` e compila. Poi le stesse su
**Vercel → Project Settings → Environment Variables**:

| Chiave | Valore |
|---|---|
| `VITE_SUPABASE_URL` | l'URL del progetto |
| `VITE_SUPABASE_ANON_KEY` | la anon key (è pubblica per design: la protegge la RLS) |
| `VITE_ADMIN_PASSPHRASE` | una passphrase **nuova**, diversa da qualunque password vera |

### 6. Secret e redeploy dell'Edge Function

```bash
supabase secrets set ALLOWED_ORIGINS="https://IL-TUO-DOMINIO.vercel.app,http://localhost:5173"
supabase functions deploy karen-oracle
```

`karen-oracle` rispondeva con `Access-Control-Allow-Origin: *`: qualunque
sito web poteva chiamarla. Ora risponde solo alle origini in quella lista.
**Se la imposti male l'app smette di parlare con Karen** — mettici il
dominio Vercel esatto, con `https://` e senza slash finale.

### 7. Dipendenze e verifica

```bash
cd C:\a\arachnoforge-build
npm install        # ESLint e plugin sono nuovi
npm run check      # lint + 214 test + build di produzione
```

`npm run check` è il comando unico da lanciare prima di ogni deploy.

---

## PARTE 2 — LE 5 COSE CHE AVEVI CHIESTO

### N1 · Data di verbalizzazione

Nel form della materia, accanto alla spunta "Esame superato", c'è ora un
campo data. Il voto entra nel grafico dell'andamento alla **data reale in
cui hai verbalizzato**, non al giorno in cui hai cliccato la spunta.
Lo storico dei voti viene anche riordinato per data: prima, se
registravi in ritardo un esame vecchio, la curva zigzagava.
Lasciando il campo vuoto vale il comportamento di prima (data di oggi).

### N2 · Esame superato = tutto archiviato

Quando marchi un esame come superato, nello stesso istante:

- **tutti i suoi nodi passano a COMPLETED**;
- tutti i `nextReviewDate` vengono azzerati, quindi la materia **esce da
  Spider-Sense** e non ti ripropone più ripetizioni di roba già data;
- la materia esce dal calcolo di ore residue, Quota Odierna, Fine
  Prevista e budget giornaliero;
- **vale anche per gli esami senza nodi** (era il caso che non
  funzionava: non c'era niente da chiudere, quindi non succedeva nulla e
  l'esame restava dentro ai calcoli).

Graficamente la materia diventa **archiviata**: card verde spenta,
badge "Archiviata", barra piena, niente più Spider-Score, niente più
verdetto di Exam Readiness, niente più allarmi rossi. Resta lì, leggibile,
ma smette di competere per la tua attenzione.

### N3 · Quando ti laurei

Nuova card in cima al **Multiverse Simulator**. Incrocia **due stime
indipendenti**:

1. **Per carico di lavoro** — ore di studio ancora necessarie (con le
   pagine, se le hai messe) divise per le ore che realisticamente fai al
   giorno, misurate sul tuo storico reale.
2. **Per ritmo di carriera** — CFU al mese ricavati dalle date di
   verbalizzazione degli esami che hai già dato (serve un minimo di 3
   esami, altrimenti questa metà non viene usata).

La stima finale non può mai essere prima dell'appello più lontano che hai
già in calendario, e la card dichiara sempre la propria **confidenza**:
finché i dati sono pochi lo dice, invece di sparare una data precisa e
falsa.

### N4 · Sidebar

*Suit Telemetry* sopra, *Karen OS Settings* ultima. Fatto.

### N5 · Pagine per argomento

Ogni nodo ha ora un campo **pagine**. Mentre scrivi, il form ti mostra in
tempo reale a quante ore corrispondono *per te*.

Il punto è quello: l'app calcola il tuo **ritmo reale in pagine/ora** dal
tuo storico (mediana, non media, così una sessione storta non falsa
tutto; servono almeno 4 sessioni con pagine registrate prima che si
fidi). Finché non ha abbastanza dati usa le ore stimate come prima e non
inventa niente.

Tutto passa da una sola funzione nuova, `nodeBudgetHours()`. Questo vuol
dire che le pagine si propagano **da sole** a: Quota Odierna, Fine
Prevista, Spider-Score, Exam Readiness, budget giornaliero, Multiverse
Simulator e stima di laurea. Non c'è un angolo dell'app che continua a
ragionare in ore stimate mentre un altro ragiona in pagine.

---

## PARTE 3 — BUG CHE ROMPEVANO DAVVERO QUALCOSA

Questi non erano rifiniture: erano funzionalità che non funzionavano e
che l'app non ti diceva di non star funzionando.

### B1 — Il Tactical Debriefing crashava, ogni volta

`handleDebriefSubmit` chiamava `setAwaitingPostFocus(false)`, una
funzione che non esisteva più. Ogni singolo debriefing lanciava un
`ReferenceError` a metà: la riga dopo era `timer.startBreak()`, che
quindi **non veniva mai eseguita**. La pausa dopo il Focus non partiva
mai automaticamente. Rimossa la chiamata morta.

### B2 — L'Overdrive non veniva registrato

`useTimerEngine` leggeva il flag `overdrive` da una closure catturata al
montaggio: al momento in cui il tick concludeva la sessione, il valore
letto era quello di partenza, non quello attivo. Le sessioni in Overdrive
venivano contabilizzate come normali — **XP e statistiche sbagliati**.
Ora il flag vive in una ref scritta in modo sincrono da `start()`.

### B3 — Spider-Sense Surge smetteva di dare feedback

Il rilevamento usava la **lunghezza** del Combat Log per capire se era
arrivato un evento nuovo. Il log è tagliato a un massimo di voci: una
volta raggiunto il tetto, la lunghezza restava costante per sempre e il
trigger non scattava più. Ora si basa sull'ID dell'ultima voce.

### B10 — Costo Stamina sbagliato in Max Carnage

L'anteprima del costo non riceveva `isMaxCarnageActive`: ti mostrava un
numero e poi te ne addebitava un altro.

---

## PARTE 4 — DUE FINESTRE DI PERDITA DATI, CHIUSE

### Il salvataggio ritardato di 2,5 secondi

Il salvataggio è debounced a 2,5s. Se chiudevi la scheda, facevi logout o
il telefono metteva l'app in background **dentro quei 2,5 secondi**,
l'ultima sessione di studio spariva.

Ora: flush forzato su `visibilitychange` e `pagehide`, `signOut` è
diventato `async` e **aspetta** il salvataggio prima di chiudere la
sessione, e ad ogni cambiamento viene scritto un **checkpoint locale
sincrono**. Se al boot successivo il checkpoint è più avanti del cloud,
l'app recupera da lì e te lo dice con un toast.

### Sovrascrittura silenziosa fra dispositivi

Studiavi dal telefono, poi aprivi il PC che aveva ancora lo stato vecchio
in memoria: il PC salvava sopra, e il lavoro del telefono spariva **senza
un messaggio**.

Ora ogni scrittura è condizionata a `updated_at` (optimistic locking). Se
il cloud è cambiato sotto, l'app si ferma e apre una finestra che ti
mostra i **due stati a confronto** — livello, XP, materie, nodi
completati, sessioni — e ti fa scegliere. Se la migrazione SQL non c'è,
degrada in silenzio al comportamento vecchio invece di bloccarsi.

---

## PARTE 5 — PRESTAZIONI

Il problema strutturale: `derived` — il blocco che ricalcola Spider-Score,
quote, readiness, budget di ogni materia — dipendeva dal timer. Il timer
cambia **una volta al secondo**. Quindi durante ogni sessione di Focus
l'app ricalcolava tutto, ogni secondo, per 25-50 minuti di fila. Su
telefono si sentiva: timer a scatti, batteria che scendeva.

Il timer vive ora in un **context separato** (`TimerContext`). Chi ha
bisogno del secondo che scorre lo prende da lì; `derived` non si accorge
più del suo passare.

Inoltre: `ArachnoForgeContext.jsx` è passato da **1919 a 1268 righe** —
il reducer è stato estratto in `src/state/reducer.js`, dove è
**testabile**; i trofei valutati sono memoizzati invece di essere
ricalcolati ad ogni render; lo Star Log viene potato automaticamente
(dettaglio delle sessioni oltre 18 mesi, mai gli aggregati né i boss),
perché cresceva senza limite dentro un'unica riga JSONB.

---

## PARTE 6 — SICUREZZA

| Cosa | Prima | Ora |
|---|---|---|
| Passphrase admin | in chiaro nel bundle | `VITE_ADMIN_PASSPHRASE` |
| Credenziali Supabase | hardcoded | env, con fallback |
| CORS Edge Function | `*` — chiunque | allowlist `ALLOWED_ORIGINS` |
| Quiz AI | illimitati | 30/giorno via RPC server-side |
| Chiamata Anthropic | senza timeout | AbortController a 45s |

---

## PARTE 7 — GRAFICA E RIFINITURE

- **Stamina vs Readiness**: la barra si chiamava "Stamina Mentale" ma
  mostrava il *readiness biometrico*. Sono due numeri diversi, e la
  confusione aveva un effetto concreto: è la Stamina vera a dimezzare gli
  XP sotto il 20%, quindi potevi leggere "100%" e prendere metà XP senza
  capire perché. Ora sono **due barre distinte**, ognuna col suo nome e
  la sua spiegazione.
- **Toast**: tetto a 4 visibili insieme (una raffica di trofei copriva
  mezzo schermo) con contatore "+N altre notifiche"; ripristinata
  l'animazione di ingresso, che era rimasta senza keyframe.
- **Scroll-to-top** al cambio pagina: arrivavi in fondo allo Star Log,
  aprivi Web-Matrix e atterravi a metà pagina su un punto vuoto.
- **Gutter laterale**: due regole di padding in conflitto lo azzeravano
  su desktop, Android e iPhone in verticale — il contenuto toccava i
  bordi. Ora `.af-viewport` è l'unica fonte di verità: il notch aggiunge
  spazio, non lo toglie.
- **Zoom**: tolto `maximum-scale=1` da `index.html`, che impediva di
  ingrandire la pagina — barriera di accessibilità vera.
- **Fatigue**: il filtro desaturava tutta la pagina, peggiorando la
  leggibilità proprio quando hai meno risorse. Il segnale resta (bordo +
  vignette), il testo torna leggibile.
- **Tasto Esc**: chiudeva il pannello sotto alla modale aperta. Ora
  controlla se c'è un dialog aperto prima di agire.
- **Cancellazione materia**: la selezione restava puntata sul nulla; ora
  seleziona la successiva.

---

## PARTE 8 — QUALITÀ DEL CODICE

- **214 test**, tutti verdi (`npm test`). Erano 0 sul reducer.
  Due test hanno trovato bug veri mentre li scrivevo: `pruneStarLog`
  potava per posizione nell'array invece che per data.
- **ESLint** configurato (flat config, `react-hooks`) + **GitHub Actions**
  su ogni push: lint, test, build.
- `.env.example` documentato.

---

## PARTE 9 — RIMASTO DA FARE (non l'ho toccato)

- **`user_data` è una sola riga JSONB.** Funziona benissimo per un utente
  e non va cambiato adesso. Ma è il motivo per cui è servito il pruning
  dello Star Log: fra due o tre anni di sessioni quella riga diventa
  pesante da scaricare ad ogni avvio. La soluzione vera sarebbe una
  tabella `sessions` separata — è un intervento grosso, da fare solo se e
  quando il boot inizia davvero a rallentare.
- **Nessun test sui componenti React.** Testare JSX richiede
  Vitest + Testing Library, cioè nuove dipendenze. Ho preferito coprire
  al 100% la logica pura, dove stavano i bug veri.
- **Nessuna modalità offline completa.** Il service worker serve la shell,
  ma senza rete le scritture restano nel checkpoint locale finché non
  torni online. Una coda di sincronizzazione vera è un progetto a sé.
- **`npm run build` non l'ho potuto eseguire**: il registry npm è
  bloccato dall'ambiente in cui lavoro. Ho verificato ogni file con un
  parser reale e caricato tutti i moduli per escludere import circolari,
  ma la build di Vite **lanciala tu** (punto 7 della Parte 1) prima di
  fare deploy.

---

*V37.0 — 20 settembre 2026*
