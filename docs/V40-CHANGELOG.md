# ArachnoForge V40 — Note di rilascio

## V40.3 — Timer, suoni e Maximum Carnage

### 1. La fine di un blocco adesso si sente
- **Il suono mancava del tutto.** L'unico avviso previsto era la notifica di sistema, che però è spenta finché non la attivi a mano: il timer arrivava a 00:00 in silenzio.
- Ora c'è un rintocco dedicato (tre campane in salita) alla fine di ogni blocco di Focus, e uno più breve alla fine della pausa.
- **Arriva puntuale anche con l'app in secondo piano.** Il suono viene piazzato sull'orologio di Web Audio nell'istante esatto in cui il blocco finirà: i browser rallentano i timer delle schede nascoste fino a un tick al minuto, quello dell'audio no. Se il dispositivo va in sospensione e quel momento passa a vuoto, il rintocco parte comunque alla riapertura. Mai due volte.
- Mettere in pausa lo annulla, riprendere lo riprogramma sul tempo che resta.
- **Il suono "a caso" era il promemoria dei 30 minuti** di Focus accumulato: c'era già, ma senza il suono di fine blocco sembrava capitare a caso. Adesso ha un interruttore suo in Karen OS Settings, separato dagli altri effetti sonori.

### 2. "Termina sessione e salva" adesso ferma davvero il timer
- **Il bug.** Dopo un Overdrive il pannello della sessione in sospeso resta visibile mentre il blocco nuovo gira: premendo "Termina sessione e salva" la sessione veniva salvata ma il countdown continuava, e l'unico modo per fermarlo era "Interrompi" — cioè il Blood Pact, con la sua penalità di XP.
- Ora chiudere la sessione ferma il blocco in corso e **aggiunge i suoi minuti interi** a quelli salvati.
- **Nuovo pulsante "Termina e salva (N min)"** durante un blocco: chiudi quando vuoi, i minuti già fatti restano tuoi, nessuna penalità.
- La conferma del Blood Pact adesso dice quanti minuti stai buttando via e che esiste l'alternativa.

### 3. Maximum Carnage Mode: spiegata e silenziabile
- **Cosa la attiva era scritto da nessuna parte.** Il banner ora ha una riga apribile: si accende da sola dopo 5 "azioni critiche" di fila (nodi Hard completati, sessioni di Focus chiuse in Overdrive, Boss Fight vinte) e dura 2 ore, con XP doppi e Stamina senza costo.
- **Il ronzio di sottofondo** è il drone simbionte. Adesso si zittisce con l'icona dell'altoparlante sul banner stesso, oppure dall'interruttore dedicato in Karen OS Settings, senza spegnere tutti gli altri suoni.
- **Bug corretto:** spegnere gli effetti sonori (o entrare in Sensory Zero) non zittiva il drone già in corso — il flag valeva solo all'accensione, quindi l'interruttore sembrava non funzionare per due ore.

### 4. Diagnostica Neurale: quali dati mancano davvero
- Il briefing diceva "oggettivi 67%" senza dire quale voce mancasse. Nella scheda del Readiness c'è ora **"Com'è composto il punteggio"**: le sette voci (tre dall'iPhone, quattro dal Recovery Survey), quali sono entrate nel calcolo e, per quelle fuori, il motivo.
- Nel tuo caso il dato non manca: il punteggio cardiaco è un **confronto** fra il battito a riposo di oggi e la tua media, e serve almeno **3 giorni registrati negli ultimi 14** perché quella media esista. Finché non c'è, quella voce resta fuori dal calcolo — senza abbassare il Readiness.
- Il pannello mostra anche l'obiettivo di sonno usato e se è quello standard o calcolato sulle tue notti.

### Verifica
- 415 test automatici, tutti verdi. ESLint: nessun errore e nessun avviso.
- Nel browser, con l'audio strumentato:
  - il rintocco viene programmato all'avvio, annullato in pausa, riprogrammato al riavvio;
  - alla scadenza suona una volta sola, sia col tempo reale sia quando l'orologio audio non è avanzato;
  - Overdrive + "Termina sessione e salva": 32 minuti salvati, timer fermo, nessun Blood Pact;
  - "Termina e salva" a metà blocco: 6 minuti salvati, nessuna penalità;
  - banner Maximum Carnage: spiegazione e interruttore del drone funzionanti;
  - Diagnostica Neurale con dati finti: il pannello indica il battito a riposo come unica voce fuori.
- Riprovate anche le prove delle versioni precedenti: coda delle lezioni, scelta dell'argomento, pagine per fonte, sincronizzazione Cloud, 20 profili di dati anomali, resa grafica a 360 e 1280 px.

---

## V40.2 — L'argomento della sintesi lo scegli tu

### Cosa cambia
- **"Su quale argomento hai fatto sintesi?"** In "Da sistemare" ogni lezione ha un menu con i nodi della materia presi dal Web-Matrix.
  - I nodi sono in ordine d'albero (i figli rientrati sotto il padre), con le pagine ancora da snellire.
  - L'app suggerisce ancora un argomento, ma decidi tu: magari sei andato più avanti. C'è anche "Nessun argomento preciso".
- **"Avvia sintesi"** apre il timer su quell'argomento, già in modo Sintesi. Vale anche per la card "ADESSO" di una lezione.
- **A fine sessione:**
  - puoi ancora cambiare argomento;
  - inserisci le pagine snellite **fonte per fonte** (libro, slide, dispense): vanno dritte in "Già snellite" di ciascuna fonte, mai oltre le pagine che le restano;
  - e le pagine dei tuoi appunti.
- **Stato del nodo automatico.**
  - Da Disponibile a **In corso** appena c'è lavoro: minuti di timer, pagine snellite, pagine di appunti o sintesi chiusa, anche aggiornando il nodo a mano.
  - Da In corso a **Completato** solo quando lo dici tu. Dopo una sessione di Studio compare "Argomento terminato: l'ho studiato tutto", spento di default; oppure dal Web-Matrix, come prima.
  - La sola sintesi non chiude mai un nodo.
- **Lezione sistemata.** Una sessione di Sintesi in cui registri delle pagine sistema la lezione anche se è breve, esattamente come l'aggiornamento a mano del nodo.
- **Grafica.** Il titolo "Valuta il tuo Focus" è di nuovo leggibile.

### Verifica
- 415 test automatici, tutti verdi. ESLint: nessun errore e nessun avviso.
- Flusso completo simulato nel browser, a 1280 e 360 px:
  - scelta di un argomento diverso da quello suggerito, sessione, pagine per fonte (quelle oltre il massimo vengono ridotte);
  - lezione sistemata e nodo "In corso";
  - sessione di Studio con "Argomento terminato": nodo Completato, con il primo ripasso fissato.
- Lo stesso flusso partendo dalla card "ADESSO".

---

## V40.1 — "Web-Shooter Inceppato" dopo un aggiornamento

### Causa
Le pagine vengono scaricate solo al primo accesso. Se esce un aggiornamento mentre l'app è aperta, i file della versione vecchia spariscono dal server. La prima volta che apri una pagina non ancora visitata, il download fallisce e compariva "Web-Shooter Inceppato", anche se nel codice non c'era nessun errore. Il caso è stato riprodotto simulando un aggiornamento con l'app aperta.

### Cosa cambia
- **Pagine precaricate.** Qualche secondo dopo l'avvio, l'app scarica in sottofondo tutte le pagine, una alla volta e solo quando il browser è libero.
  - Aprire una pagina diventa istantaneo.
  - Un aggiornamento uscito con l'app aperta non rompe più la navigazione.
- **Avviso chiaro se il download fallisce lo stesso** (per esempio offline): "Nuova versione disponibile" con il pulsante "Ricarica l'app", invece dell'errore generico.
- **Errori veri più facili da risolvere.**
  - Nuovo pulsante "Riprova".
  - "Torna allo Stark-Web Terminal" ora funziona anche quando l'errore è proprio su Mission Control.
  - "Dettagli tecnici" mostra il messaggio d'errore, con un pulsante per copiarlo.
- **Star Log.** Una voce non valida in un backup importato a mano (per esempio `null`) poteva bloccare l'intera app: ora viene scartata al caricamento.

### Verifica
- 405 test automatici, tutti verdi.
- ESLint: nessun errore e nessun avviso.
- Build a pagine separate: tutte le pagine si aprono.
- Aggiornamento simulato con l'app aperta:
  - con il precaricamento, la pagina si apre normalmente;
  - senza, compare l'avviso e "Ricarica l'app" risolve.
- 20 profili di dati anomali, su tutte le pagine: nessun errore.

---

*Da qui in giù: la V40.0.*

## 1. Lezioni e sintesi: niente più lavoro inventato

### Problemi
- **Lavoro inesistente.** Ogni lezione finita entrava in "Da sistemare" e faceva maturare ore di sintesi, anche per una materia senza nodi né fonti.
- **Sintesi fatta fuori dall'app ignorata.** Anche aggiornando a mano il nodo, la lezione restava da sistemare.
- **Lezioni non seguite.** Non c'era modo di dire che a quella lezione non eri andato.
- **Esami scavalcati.** In "ADESSO" la lezione passava sempre davanti agli esami del 2° anno.

### Cosa cambia
- **Solo lezioni con qualcosa da sistemare.** Una lezione è da sistemare solo se la materia ha fonti con pagine ancora da snellire nei suoi nodi.
  - Materie senza fonti, o con le fonti già snellite, non generano debito.
  - Oggi vengono elencate a parte: "Seguite ma senza fonti nei nodi".
- **Sintesi a mano riconosciuta.** Se dopo la lezione fai avanzare a mano la sintesi di un nodo, la lezione risulta "sistemata sui nodi".
  - Conta se aumentano le pagine snellite, se chiudi la sintesi o se aggiungi pagine dei tuoi appunti.
- **Nuovi pulsanti nella coda.**
  - **Già fatta:** l'hai sistemata anche fuori dall'app. Conta nel passo della settimana.
  - **Niente da sistemare:** non l'hai seguita, o non c'era niente. Non genera debito.
  - Per le lezioni di oggi, entrambe si annullano toccando lo stato della lezione nell'elenco.
- **Minuti di sintesi conteggiati con precisione.**
  - I minuti delle sessioni Sintesi vanno alle lezioni finite prima, partendo dalla più recente.
  - Una sessione di un minuto non sistema una lezione di due ore: serve almeno metà della sintesi prevista.
  - Nessun minuto viene contato due volte.
- **Aggiungere fonti non crea debito arretrato.** Le lezioni finite prima della prima fonte della materia non diventano debito.
- **Stato di ogni lezione di oggi, a colpo d'occhio:** da sistemare, sistemata, sistemata sui nodi, niente da sistemare, nessuna fonte nei nodi, fonti già snellite.

## 2. Piano del giorno: prima gli esami
- **Nessuna ora dai CFU senza nodi e senza data.** Una materia senza nodi e senza data d'esame non riceve più ore dalla stima dei CFU (es. i corsi del 3° anno che segui a lezione).
  - La stima resta per la previsione di laurea.
  - Non viene più scelta come Primary Target.
- **Le lezioni non rubano slot agli esami.** La sintesi delle lezioni ha una riserva di tempo:
  - prende solo il tempo che gli esami in focus lasciano libero, al massimo il 40% della giornata;
  - è zero se gli esami occupano tutta la giornata o se c'è un appello entro 10 giorni;
  - non può mai creare un deficit sugli esami.
- **"ADESSO" e "POI".** La lezione passa in testa ad "ADESSO" solo se nessun esame in focus è a rischio; altrimenti compare come "POI", con il tempo riservato o una nota.
- **Budget sempre coerente.** Il budget mostra studio e sintesi separati ("Oggi: 2h 48m di studio + 1h 42m di sintesi su 4h 30m"). Niente più "deficit di 0m" da arrotondamento.
- **L'avanzo resta proporzionato.** Il tempo avanzato non supera mai il lavoro reale di una materia: 30 minuti di nodo non diventano 3 ore.
- **Materie senza data più calme.** Non pulsano più in ambra come "Attenzione": sono "Senza data", in stile neutro.

## 3. Prestazioni (rallentamenti e scatti)
Misurate con dati realistici (16 materie, 122 nodi, un anno di sessioni) e CPU rallentata ×4:

- **Bordi e bagliori pulsanti.** Critico, Attenzione, Goblin, Carnage, Spider-Sense e i nodi sbloccabili ora animano solo l'opacità di un livello separato. Prima ridisegnavano l'intera card, e la sfocatura sotto, 60 volte al secondo.
  - Web-Matrix: da ~220 a ~15 ms/s di lavoro di disegno.
  - Star Log: da ~200 a ~5 ms/s.
- **Sfocatura di sfondo.** Tolta dentro le pagine, dove non si vedeva; resta su modali, drawer, menu e barra laterale.
- **Livelli fissi.** Grana, vignette e bagliori decorativi hanno un livello proprio. Rimosso `mix-blend-mode` dagli strati a tutto schermo animati.
- **Timer.** L'anello non è più in animazione continua. Mission Control durante una sessione: da ~120 a ~50 ms/s.
- **Coda delle lezioni.** Un solo passaggio sullo Star Log invece di uno per ogni lezione.

## 4. Bug nascosti corretti
- **Due campi dei nodi persi a ogni caricamento dell'app.** Venivano scartati dalla migrazione:
  - `chiusoDaVerbale`: i nodi chiusi dall'esame verbalizzato tornavano a falsare la calibrazione;
  - la nuova marca di sintesi manuale.
- **Salvataggio immediato dall'editor del nodo.** Ora usa lo stato calcolato dal reducer, identico a quello mostrato.
- **Web-Matrix.** Si apre sulla materia del Primary Target, non sulla prima dell'elenco (spesso un esame già archiviato).
- **Timer fermo.** Mostra la durata del prossimo blocco (25:00) invece di "00:00".
- **Conteggi.** Il badge del Campus e la striscia di Mission Control contano le lezioni, non le materie.
- **Test.** La potatura degli esiti usa una data di riferimento, così i test non scadono col calendario.

## 5. Grafica
- **Radar Spider-Sense su telefono.** Una scheda per ripasso con i tre pulsanti a tutta larghezza, date leggibili ("18 set").
- **Stato delle lezioni su telefono.** Va sotto il nome, che non viene mai schiacciato.
- **Numeri più leggibili:** "1 pagina", "30m" invece di "0.5h", ore e minuti anche in Multiverse e Impostazioni.
- **Card del Web-Matrix.** Avvisi compatti ("Traiettoria insostenibile"); il dettaglio resta nella scheda della materia.
- **Nodi sbloccabili nello Skill Tree.** Il bagliore è di nuovo visibile.

## 6. Verifica
- **Test:** 400 test automatici, tutti verdi. I nuovi coprono la coda delle lezioni, gli esiti manuali, la sintesi registrata sui nodi, la riserva di sintesi, la migrazione e il budget.
- **Controlli sul codice:**
  - ESLint con le regole del progetto: nessun errore e nessun avviso, dopo aver tolto due commenti `eslint-disable` inutili, due assegnazioni superflue e una variabile d'errore mai usata.
  - Il plugin degli hook React non era installabile qui: le regole degli hook sono state verificate con un controllo a parte, senza violazioni.
  - TypeScript sul progetto: nessun nome non definito e nessuna variabile locale inutilizzata.
- **Resa grafica:** 360, 768 e 1280 px su tutte le pagine, con due set di dati. Nessun overflow orizzontale, nessun testo schiacciato, nessun errore in console.
- **Flussi simulati nel browser:**
  - la sera di lunedì con le tue materie: nessuna sintesi inventata, "ADESSO" sull'esame;
  - un nodo aggiornato a mano che toglie la lezione dalla coda;
  - "Già fatta" e "Niente da sistemare";
  - la sincronizzazione Cloud, con tutti gli scenari della V39.

## 7. Da fare
1. `npm install`, poi `npm run check`.
2. Se non l'hai già fatto (V37–V39): esegui la migrazione `supabase/user_data_v6_optimistic_locking.sql`, chiudi le registrazioni pubbliche, cambia la vecchia passphrase admin e imposta `VITE_ADMIN_PASSPHRASE`.
