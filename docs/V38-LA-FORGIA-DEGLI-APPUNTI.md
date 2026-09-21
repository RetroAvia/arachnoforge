# ArachnoForge V38.0 — "La Forgia degli Appunti"

---

## PARTE 1 — COSA CAMBIA, IN UNA FRASE

Prima l'app sapeva **quanto devi studiare**. Ora sa anche **quanto devi
scrivere per avere qualcosa da studiare** — e tiene i due conti separati,
perché sono due lavori con due ritmi diversi e due modi diversi di
restare indietro.

Il motivo per cui nessuna app fa questo: tutte partono dal presupposto
che il materiale da studiare esista già. Conti le pagine, le dividi per
i giorni, hai il piano. Nella realtà di un semestre metà del lavoro è
**fabbricare** quel materiale: 300 slide e 1000 pagine di libro che
diventano 40 pagine tue.

Contarle come "da studiare" dà un piano terrorizzante e inutile.
Ignorarle e contare solo le 40 dà un piano che ti dice che sei in pari
fino al giorno in cui scopri di non esserlo.

---

## PARTE 2 — COME FUNZIONA

### Le fonti, per argomento

Ogni nodo ha ora un blocco **Forgia degli Appunti**:

- **Fonti** — quante ne vuoi, ognuna con tipo (Libro / Slide del prof /
  Dispense / Altro), pagine totali e pagine già snellite;
- **Pagine dei tuoi appunti** — quelle già scritte;
- **Appunti completi** — la spunta per dire "la sintesi di questo
  argomento è chiusa" anche se non hai lavorato tutte le pagine
  dichiarate (metà libro era ripasso, tre capitoli non sono in
  programma).

Mentre scrivi, il blocco mostra in diretta cosa ne esce: *"Appunti
finali previsti: 44 pagine (20 + 24) — 20h di sintesi + 9h di studio =
29h"*. A volte quel numero è la ragione per **non** mettere quel libro
fra le fonti, ed è esattamente il punto.

### I due bilanci

Ogni argomento ha da quel momento due conti distinti:

| | cosa misura | a che ritmo |
|---|---|---|
| **Sintesi** | pagine di fonte ancora da snellire | il tuo ritmo di sintesi, misurato |
| **Studio** | pagine dei tuoi appunti ancora da studiare | il tuo ritmo di lettura, misurato |

La somma è il costo reale dell'argomento. E poiché passa tutta da una
sola funzione (`nodeBudgetHours`), le fonti entrano **da sole** in Quota
Odierna, Fine Prevista, Spider-Score, Exam Readiness, budget giornaliero
e stima di laurea. Nessuno di quei motori ha dovuto essere toccato.

### La proiezione

Le pagine finali di appunti non si conoscono in anticipo: si scoprono
snellendo. Ma dopo tre argomenti chiusi il rapporto è misurabile — *"da
100 pagine di fonte ne escono 20 mie"* — e da lì il totale futuro si
proietta.

Finché il campione è troppo piccolo si usa un valore di partenza
**dichiarato**, e il pannello lo dice apertamente invece di spacciarlo
per una misura.

### Il numero che nessuna app dà: la data di chiusura appunti

Questo è il pezzo che rende utile tutto il resto.

Gli appunti non vanno finiti *per* l'esame. Vanno finiti abbastanza
**prima** dell'esame da lasciare il tempo di studiarli. Quel margine si
calcola — ore di studio proiettate diviso la tua capacità giornaliera
reale — e sottratto dalla data d'esame dà una scadenza vera:

> **APPUNTI DA CHIUDERE ENTRO — 12 dicembre 2026**
> Fra 48 giorni. Non è la data d'esame: è il giorno oltre il quale non
> resterebbe abbastanza tempo per studiare quello che stai scrivendo
> (23 giorni di studio previsti).

È sempre più vicina di quella che uno si immagina. Accanto trovi la
**quota di pagine da snellire oggi** per arrivarci, e quando la superi
il pannello diventa rosso e te lo dice in faccia.

### Il consiglio: oggi scrivo o studio?

Il pannello **Piano Appunti** (in Web-Matrix, sotto l'Exam Readiness) dà
un verdetto secco:

- **SINTESI** — resta fonte da snellire e non c'è ancora materiale tuo
  pronto. Non puoi studiare quello che non hai ancora scritto.
- **SINTESI (urgente)** — sei oltre la data di chiusura appunti.
- **SINTESI + STUDIO** — *"N pagine di fonte oggi per restare in linea,
  il resto della giornata sugli argomenti già pronti."* È il caso
  normale di metà semestre: alcuni argomenti sono pronti, altri no.
- **STUDIO** — gli appunti sono chiusi, da qui è tutto studio.

Funziona anche **senza data d'esame**: il caso della materia che recuperi
da zero in autonomia. Lì non c'è scadenza, ma il bilancio delle ore e il
consiglio restano — che è ciò che serve per decidere oggi.

### Durante la sessione

- Sotto il countdown di Mission Control compare il **modo consigliato**
  per l'argomento attivo. È la differenza fra aprire il libro e aprire il
  quaderno, e si decide prima di mettersi a sedere.
- Nel **Tactical Debriefing**, se l'argomento ha fonti aperte, compare un
  blocco compatto: *Sintesi | Studio* già preselezionato correttamente, e
  in modo Sintesi due campi facoltativi — pagine di fonte fatte, pagine
  tue prodotte.

  Sono **facoltativi**: puoi continuare a chiudere una sessione con un
  click solo, come prima. Ma sono i due numeri con cui l'app impara il
  tuo ritmo, e il piano avanza da solo mentre lavori.

  I placeholder suggeriscono cosa ci si aspetterebbe al ritmo corrente
  ma **non precompilano**: un numero scritto dall'app e poi rimisurato
  dall'app come fosse un dato vero congelerebbe il ritmo sul suo valore
  di partenza — la calibrazione smetterebbe di imparare proprio mentre
  sembra funzionare.

### Due nuovi numeri in Karen OS Settings

Nel pannello Calibrazione, accanto a capacità giornaliera, precisione
delle stime e ritmo di lettura:

- **RITMO DI SINTESI** — quante pagine di fonte snellisci davvero in
  un'ora;
- **RESA DI SINTESI** — quante pagine tue escono da 100 di fonte.

Entrambi dichiarano apertamente se sono misurati o ancora un punto di
partenza.

---

## PARTE 3 — COSA SUCCEDE AI TUOI DATI

**Niente si perde.** Il campo `pagine` della V37 significava già "le
pagine dei miei appunti", quindi migra direttamente in `pagineAppunti` e
continua a guidare il calcolo dello studio esattamente come prima.

Un argomento **senza fonti dichiarate** si comporta in modo identico alla
V37: nessuna ora di sintesi, nessun pannello, nessun campo in più nel
Debriefing. La feature compare solo dove la usi.

Le ore già tracciate sui nodi esistenti vengono attribuite allo studio
(prima della V38 la sintesi non esisteva come attività, quindi erano
tutte ore di studio). Senza questo passaggio, al primo avvio dopo
l'aggiornamento le ore residue di ogni materia sarebbero tornate al
totale pieno e il ritmo di lettura misurato in V37 si sarebbe azzerato.

Schema dati: **11.0.0**. Migrazione non distruttiva, come sempre.

---

## PARTE 4 — ALTRE CORREZIONI DI QUESTA VERSIONE

### Un bug reale trovato dalla suite di test

Tre file di test costruivano le date nel calendario **UTC**, mentre tutta
l'app ragiona in giorni di calendario **locali**. Le due cose coincidono
per 22 ore al giorno e divergono di un giorno intero fra la mezzanotte
italiana e quella UTC — cioè dalle 00:00 alle 02:00.

Risultato: una suite che passava di pomeriggio e falliva su 9 test di
notte, facendo sospettare una regressione che non c'era. Ora l'attesa si
costruisce con le stesse funzioni del codice sotto test.

### Il Debriefing chiedeva le pagine dell'argomento sbagliato

Il modal riceveva il nodo **attualmente attivo**, ma il salvataggio
avviene sul nodo della sessione **in sospeso**. Normalmente coincidono —
ma non dopo "Avvia Comunque", che apre un Focus su un altro argomento
mentre il Debriefing precedente è ancora da compilare. Le pagine sarebbero
state chieste su un argomento e accreditate a un altro.

### Il ritmo di sintesi si misurava su unità incompatibili

Prima misurava `pagine totali snellite / minuti tracciati da V38`. Il
numeratore è un totale di sempre (comprese le pagine dichiarate a mano),
il denominatore riparte da zero: un libro con 500 pagine già dichiarate e
una sessione da 30 minuti avrebbe dato **1020 pagine/ora**, e il piano
sarebbe stato dieci volte troppo ottimista — l'esatto contrario di ciò
per cui la funzione esiste. Ora si misura sulle singole sessioni, dove
minuti e pagine sono omogenei per costruzione.

### Le ore di sintesi venivano scontate due volte

Il residuo di un nodo sottraeva tutte le ore tracciate, incluse quelle di
sintesi già contate in pagine: lavoro che esiste ancora spariva dal
piano. Ora si sottrae solo il tempo speso studiando.

### Sessione recuperata dopo un crash

Quando l'app recupera una sessione orfana al boot, nessuno ha risposto al
Debriefing e non si sa come sia stata spesa. I minuti entrano nel totale
(XP, streak, bias come sempre) ma **non** in uno dei due contatori
separati: attribuirli d'ufficio allo studio inquinerebbe il ritmo
misurato con ore che potevano essere di sintesi.

### Interfaccia

- L'editor delle fonti collassava il menu a tendina a larghezza zero su
  schermo da 360px dentro una modale: ora il tipo di fonte prende una
  riga sua sotto il breakpoint.
- Il cestino di una fonte era un bersaglio da 32×32px accanto a un campo
  numerico: portato a 44px.
- Tre input numerici senza label associata: ora hanno `htmlFor`/`id`, e
  il tap sull'etichetta porta il fuoco al campo.
- Il placeholder dei campi compatti era sotto la soglia di contrasto AA —
  ed è un placeholder che porta informazione vera. Nuovo token
  `INPUT_SM` nel design system, con lo stesso contrasto degli altri
  input, al posto di due copie a mano della stessa stringa.

### Pulizia

- `HOURS_PER_NODE_DAY` e `HOURS_PER_CFU` spostate in un modulo foglia
  condiviso: erano finite duplicate a mano in due file, e chi avesse
  cambiato quella "vera" avrebbe lasciato la data di chiusura appunti a
  ragionare sul vecchio valore senza che niente lo segnalasse.
- Cinque import morti rimossi (residui dell'estrazione del reducer in
  V37) e due export mai usati.

---

## PARTE 5 — VERIFICA

- **282 test**, tutti verdi (erano 214 in V37, 268 dopo i nuovi del
  motore, 282 con quelli del reducer).
- Ogni file `.js` / `.jsx` / `.ts` / `.css` passato attraverso un parser
  reale.
- Tutti i moduli caricati in sequenza: **nessun ciclo di import**. Ne
  esisteva uno latente — `materiaMeta` importa `sintesiEngine`, quindi
  quest'ultimo non poteva importare le costanti a ritroso: è il motivo
  di `planningConstants.js`.
- Due revisioni indipendenti del codice: import inesistenti, simboli
  fuori scope, prop non allineate fra chiamante e componente, campi di
  `derived.calibration` letti ma mai scritti, nomi di icona inesistenti.
  Tutti i difetti trovati sono stati corretti.

**`npm run build` non è stato eseguito**: il registry npm è bloccato
nell'ambiente in cui lavoro. Lancialo tu prima del deploy:

```bash
cd C:\a\arachnoforge-build
npm run check      # lint + 282 test + build di produzione
```

---

## PARTE 6 — RIMASTO DA FARE

- **Nessuna vista storica della sintesi.** Lo Star Log registra modo e
  pagine di ogni sessione (i dati ci sono già, sulla voce che esiste
  già), ma non c'è ancora un grafico "pagine snellite al mese". Si può
  aggiungere senza toccare il motore.
- **Le fonti non hanno un'etichetta libera in UI.** Il campo esiste nel
  dato (`fonte.etichetta`) ma il form mostra solo il tipo: con due libri
  diversi sullo stesso argomento si distinguono solo dall'ordine.
- **La resa è una sola, globale.** In realtà cambia per materia (da un
  libro di Analisi esce più roba che da uno di Diritto). Serve abbastanza
  storico per misurarla per materia prima che abbia senso separarla.
- Restano in piedi le voci della V37: la riga JSONB unica di
  `user_data`, l'assenza di test sui componenti React, l'offline
  incompleto.

---

*V38.0 — 21 settembre 2026*
