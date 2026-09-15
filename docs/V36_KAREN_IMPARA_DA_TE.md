# ArachnoForge — V36.0 "Karen impara da te"

Guida operativa alla release: cosa è cambiato, perché, e cosa devi fare tu
per metterla in funzione.

**Migrazioni SQL necessarie: nessuna.** Tutti i campi nuovi vivono dentro
`user_data.app_state` (Cloud State) e vengono aggiunti dalla migrazione
non distruttiva già presente in `src/data/defaultSchema.js`
(`migrateSfida` / `hydrateState`, schema `9.0.0`). Nessun profilo viene
resettato, nessuna colonna nuova su Supabase.

---

## 1. Cosa fare, in ordine

```bash
# 1) Frontend — nient'altro che il solito
npm install
npm run build        # il service worker e le icone stanno in public/, Vite le copia da sé

# 2) Edge Function — ridispiega, lo schema del prompt è cambiato
supabase functions deploy karen-oracle
```

Poi, **una volta sola, dall'app**:

1. Karen OS Settings → **Notifiche e schermo** → attiva le notifiche (il
   permesso del browser si può chiedere solo da un click esplicito).
2. Su iPhone: apri l'app in Safari → Condividi → **Aggiungi a Home**. Da
   lì parte a schermo intero, con la sua icona, e funziona anche offline.
3. Karen OS Settings → **Calibrazione**: all'inizio dirà che la capacità
   non è ancora calibrata. È corretto — servono 7 giorni di sessioni
   registrate per la capacità e 5 nodi completati per il fattore stime.

---

## 2. Algoritmo

### 2.1 Spaced Repetition: intervalli che crescono (`src/utils/spiderSense.js`)

Prima gli intervalli erano **costanti**: 7 giorni al primo completamento,
poi 4/2/1 per Facile/Medio/Difficile, per sempre. Un nodo che sapevi
perfettamente tornava ogni 4 giorni a vita, e il carico di ripassi
cresceva **linearmente** col numero di nodi completati — a tre mesi dalla
sessione la lista diventa ingestibile e si smette di guardarla. È così
che muoiono i sistemi di ripetizione dilazionata.

Ora ogni nodo porta `srsEase` (1.3-3.2) e `srsIntervalDays`, e
l'intervallo successivo è **moltiplicativo** (SM-2 lite): un nodo solido
percorre 7 → 22 → 74 → 180 giorni invece di ripresentarsi ogni 4. Un
giudizio "Difficile" riporta l'intervallo a 1 giorno e abbassa l'ease: la
curva riparte.

**Vincolo d'esame**: nessun ripasso viene mai schedulato oltre la data
dell'esame. Man mano che l'esame si avvicina gli intervalli si comprimono
da soli — nessuna "modalità ripasso pre-esame" da attivare a mano.

I tre pulsanti di ripasso ora mostrano l'intervallo **reale di quel
nodo** ("Facile +39gg"), non più i 4/2/1 fissi uguali per tutti.

*Migrazione*: un nodo pre-V36 riceve come intervallo di partenza quello
che il vecchio motore gli avrebbe dato per il suo ultimo giudizio — la
curva riparte da dove il nodo si trovava davvero, non da zero.

### 2.2 Calibrazione sul tuo storico (`src/utils/calibration.js`)

Due costanti inventate sostituite da due numeri misurati su di te:

| Prima | Ora |
|---|---|
| `HOURS_PER_NODE_DAY = 4.5` (studente ideale) | Media reale delle tue ore di Focus sugli ultimi 30 giorni **di calendario** |
| Ore stimate prese per buone | Mediana di (ore reali / ore stimate) sui nodi chiusi |

La capacità include i giorni di riposo nel denominatore: è deliberato —
una proiezione che presuppone che tu studi anche la domenica non è una
proiezione, è un augurio. (È anche il motivo per cui non serve una logica
feriale/weekend separata: i weekend sono già dentro il calcolo, pesati
per come li vivi davvero.)

Entrambi degradano con onestà: sotto la soglia di campioni tornano ai
default e si **dichiarano non affidabili** in Karen OS Settings, invece di
mostrare un numero autorevole costruito su due sessioni.

Da qui in giù ogni motore (Quota Odierna, Spider-Score, Fine Prevista,
Exam Readiness) parte dagli stessi due numeri: non possono divergere.

### 2.3 Spider-Score → Pressure Formula (`src/data/vanvitelliCourseMap.js`)

La vecchia formula (`Difficoltà + Esami Sbloccati + 1000/Giorni`)
ignorava **completamente** il lavoro residuo: una materia a 20 giorni con
3 ore rimaste scavalcava una a 25 giorni con 80 ore da fare. E conviveva
con un secondo motore di priorità (il `paceRatio` della Quota Odierna) che
usava criteri diversi — "Primary Target" e "In focus oggi" potevano
indicare due materie diverse senza che nulla lo spiegasse.

Ora entrambi misurano la stessa cosa:

```
pressione   = ore residue calibrate / (giorni mancanti × capacità reale)
importanza  = 1 + peso esami sbloccati/4 + (difficoltà-3)/10 + CFU/30
SpiderScore = 10 × pressione × importanza + termine strutturale
```

`pressione > 1` significa letteralmente "al tuo ritmo reale non ci
arrivi". Il tempo resta dominante (è al denominatore) ma domina **per un
motivo misurabile**, non per un'iperbole. `computeUnlockWeight`, scritta
nella V18 e mai usata da nessuno, rientra in gioco al posto del conteggio
grezzo: superare uno snodo come Analisi 1 pesa più di un esame terminale.

### 2.4 Budget giornaliero globale (`src/hooks/useKarenAutoRouter.js`)

Con due materie in focus l'app mostrava due "Oggi: Xh" calcolati in totale
isolamento, la cui somma poteva superare qualunque giornata reale — e lo
scoprivi a sera, avendo fallito entrambe le quote.

Ora esiste **un** budget (la capacità reale, ridotta dalla direttiva
`load_adjustment_pct` di K.A.R.E.N.) che viene ripartito fra le materie in
focus. Se non basta, il deficit viene **dichiarato**:

> *Karen: il piano di oggi eccede di 2h 40m la tua capacità reale. Un
> deficit che si ripete significa che va spostata una data d'esame o
> tagliato del programma, non recuperato a forza di volontà.*

### 2.5 La riduzione di carico ora esiste davvero

`mission_control.load_adjustment_pct` era un **banner e basta**: Karen
diceva "-30% oggi" e il numero sotto continuava a chiedere le stesse ore.
Ora moltiplica il budget reale della giornata. Una direttiva che il
sistema stesso ignora insegna a ignorare tutte le direttive.

### 2.6 Exam Readiness Index (`src/utils/examReadiness.js`)

Il verdetto esplicito che mancava: **SOSTIENI / AL LIMITE / RIMANDA**.

| Pilastro | Peso | Da dove viene |
|---|---|---|
| Copertura | 45% | Nodi completati, pesati per **ore** (12 nodi da 30' ≠ 3 nodi da 6h) |
| Stabilità | 30% | `memoryRadar` dello Spider-Sense |
| Fattibilità | 15% | La Fine Prevista calibrata arriva prima dell'esame? |
| Attrito | 10% | Friction Analytics (% di ripassi "Difficile") |

Un pilastro senza dati vale un neutro **dichiarato** (compare "n/d") e la
confidenza scende: l'indice ammette di star tirando a indovinare invece di
mostrare un 82% autorevole e falso. Visibile come badge su ogni card del
Web-Matrix e come card completa — con **burn-down** (giorni che servono vs
giorni disponibili) — sulla materia aperta.

---

## 3. K.A.R.E.N.

### 3.1 Il ciclo si chiude (`computeYesterdayOutcome`)

Karen emetteva quattro direttive ogni mattina e **nessuno verificava mai
se funzionassero**: il prompt riceveva il testo del briefing precedente,
non il suo esito. Ogni giorno ripartiva da zero, incapace per costruzione
di accorgersi che la finestra che consiglia da due settimane è proprio
quella in cui non studi mai.

Ora nel prompt entra `esito_di_ieri`: minuti studiati, qualità prevalente
dal Tactical Debriefing, e quante sessioni sono cadute **dentro** la
finestra consigliata. La regola 10 del system prompt impone di usarlo per
correggere il tiro — spostare la finestra se la ignori, accorciare il
preset se le sessioni sono state DISTRACTED, dire apertamente che il piano
è troppo ambizioso se i minuti restano sotto il carico per giorni.

Costo: zero chiamate aggiuntive, zero query aggiuntive (stesso `app_state`
già letto per la finestra storica).

### 3.2 Aggancio per indice, non per stringa

L'unico legame fra la scelta di Claude e il nodo reale era il confronto
esatto fra due stringhe che Claude riscriveva a mano: *"Equazione di
Bernoulli"* vs *"Equazioni di Bernoulli"* = nessun abbinamento, la card
perdeva gli id e con essi la riconciliazione live, **senza che nulla lo
segnalasse**.

Ora il paniere viaggia numerato, Claude restituisce un `candidato: <id>` e
il testo autorevole lo mette il server leggendolo dal nodo vero. Il vecchio
matcher testuale resta come rete di sicurezza.

### 3.3 Target di sonno personale

`SLEEP_TARGET_MIN = 450` era un numero da manuale in un'app monoutente con
mesi di notti registrate. Ora è la **mediana reale** delle tue notti —
limitata però fra 6h e 9h: senza quei paletti, un mese di sonno scarso
ri-normalizzerebbe il target verso il basso e il punteggio smetterebbe di
segnalare il problema proprio quando è cronico. È l'errore classico di
questo tipo di calibrazione, ed è evitato di proposito.

### 3.4 Interrogazione K.A.R.E.N. (nuova, on-demand)

Tutta la ripetizione dilazionata poggiava su **un'autovalutazione
soggettiva**: Facile/Medio/Difficile premuto dopo aver riletto gli
appunti. La sensazione di "sì, lo so" subito dopo una rilettura è
notoriamente scollegata dal richiamo reale, e quando sei stanco è
sistematicamente generosa — cioè proprio quando l'errore costa di più.

Su ogni nodo completato c'è ora **"Preparala"**: K.A.R.E.N. legge titolo,
obiettivo, blueprint e i tuoi appunti e genera 6-8 domande di richiamo
attivo (definizione, derivazione, applicazione, confronto, errore-tipico,
calcolo), ognuna con una traccia di autocorrezione rivelabile a parte.
Rispondi a mente, riveli la traccia, **poi** dai il giudizio: non più una
sensazione, ma l'esito di un tentativo reale.

- È **on-demand**: una chiamata per click, mai schedulata.
- Si salva **dentro il nodo** (`sfida.quiz`): dal secondo ripasso è già
  lì, anche offline, senza nessuna chiamata AI.
- Se il nodo ha poco materiale scritto, Karen lo dice invece di produrre
  otto domande generiche spacciate per mirate.

*Quello che non ho costruito*: la correzione automatica di una risposta
scritta a mano (tecnica Feynman valutata dall'IA). È il passo successivo
naturale e richiede un secondo giro di chiamata + una UI di editing; le
domande da sole coprono già il grosso del beneficio.

---

## 4. Funzionalità

### 4.1 PWA, notifiche, wake lock

`index.html` era nudo: nessun manifest, nessun service worker, zero
occorrenze di `Notification` o `wakeLock`. Con lo schermo bloccato la fine
di un blocco Focus non ti raggiungeva in nessun modo.

- `public/manifest.webmanifest` + icone → installabile in home screen.
- `public/sw.js` → l'app si apre e funziona **offline** (lo stato era già
  local-first). Deliberatamente **non** mette in cache i dati Supabase:
  una PWA che serve un briefing stantio è peggio di una che non parte.
- Notifica di sistema a fine blocco e a fine pausa + vibrazione.
- **Wake Lock** durante il Focus (mai durante la pausa: lì spegnere è il
  punto). Senza, Sensory Zero si spegneva da solo dopo trenta secondi.

### 4.2 Appunti del nodo

Il contenuto ora vive **dentro** l'app: formule, passaggi chiave, errori
tipici, pagina della dispensa. Prima un ripasso obbligava a uscire e
ritrovare gli appunti altrove — l'attrito per cui i ripassi brevi finivano
saltati. Compaiono a ogni apertura del nodo e a ogni ripasso, e sono anche
il materiale che K.A.R.E.N. legge per l'interrogazione.

### 4.3 Scorciatoie da tastiera

`Spazio` avvia/pausa · `Esc` Sensory Zero · `D` pannelli.
Ignorate mentre scrivi in un campo di testo o con un modal aperto.

### 4.4 Promemoria di backup

L'intero percorso di studi vive in un'unica riga `user_data.app_state`. Il
Data Ledger ora dice da quanti giorni non esporti una copia locale e lo
segnala oltre i 14. Nessun download automatico: sarebbe invadente e i
browser lo bloccherebbero comunque.

---

## 5. Grafica

- **"Una cosa alla volta"** (attivo di default, disattivabile). Lo
  Stark-Web Terminal si apre sulla card **ADESSO**: argomento, minuti,
  Avvia. Briefing, Quota e Daily Patrol restano a un click. Il numero di
  pannelli che chiedono attenzione insieme è esso stesso una fonte di
  stress, ed è ciò che l'app esiste per togliere.
- **Effetti leggeri** (`[data-effects="lite"]`): spegne in blocco
  `backdrop-filter`, grana, interferenza e animazioni cicliche. Gli stati
  critici restano riconoscibili dal colore del bordo al posto del
  lampeggio. Nessuna informazione va persa.
- `backdrop-blur-2xl` → `backdrop-blur-lg` su tutte le card. È l'effetto
  più costoso del Design System e veniva applicato a ogni card: con decine
  di card per pagina è il primo punto in cui si perdono frame su mobile.
- **Fatigue UI**: non desatura più l'intera pagina. Il segnale resta
  (vignette + bordo interno) ma il testo torna leggibile — l'app deve
  dirti che sei stanco, non renderti più difficile leggere.
- **Contrasto**: `text-slate-500`/`600` alzati di uno scalino
  (`index.css`, override documentato in un solo punto). Era il colore di
  tutte le righe esplicative, cioè proprio quelle da leggere sul telefono
  di sera.
- **Notch**: `viewport-fit=cover` + `env(safe-area-inset-*)`.
- **Burn-down** per materia: due barre, servono vs disponibili. Se la
  prima è più lunga della seconda, non ci arrivi.

---

## 6. Verifica

```bash
npm test     # 161 test, tutti verdi
deno test supabase/functions/karen-oracle/_logic.test.ts
```

I test nuovi coprono la crescita degli intervalli SRS e il cap sull'esame,
la calibrazione e il suo degrado sotto soglia, i verdetti dell'Exam
Readiness, il riparto del budget giornaliero, l'esito di ieri e la
risoluzione dei candidati per indice.

**Nota**: i test Deno dell'Edge Function non sono stati eseguiti (l'ambiente
in cui è stata scritta questa release non ha il CLI Deno); il type-check di
`_logic.ts` e `index.ts` passa. Eseguili prima del deploy in produzione.

Controlli manuali consigliati dopo il deploy:

- [ ] Completa un nodo e riaprilo: "Prossimo ripasso" mostra l'intervallo.
- [ ] Ripassa lo stesso nodo due volte con "Facile": l'intervallo cresce.
- [ ] Su una materia con esame fra 3 giorni: nessun ripasso oltre l'esame.
- [ ] `curl` su `karen-oracle` con `force: true`: `directives.study_focus`
      valorizzato e agganciato agli `sfidaId` reali.
- [ ] Avvia un Focus, blocca lo schermo: alla fine del blocco arriva la
      notifica.
- [ ] Karen OS Settings → Calibrazione: i due numeri riflettono il tuo
      storico (o dichiarano di non essere ancora calibrati).
