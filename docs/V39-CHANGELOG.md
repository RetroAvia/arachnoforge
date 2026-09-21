# ArachnoForge V39.0 — Note di rilascio

## 1. Bug segnalati

### Finestre e pannelli
- **Modali.** Si vedeva la pagina superiore sopra la sfocatura, e nel form del nodo i campi "Nome nodo" e "Obiettivo" passavano sopra l'intestazione, con la X visibile ma non cliccabile.
  - Le modali ora sono disegnate direttamente nel `<body>`.
  - Il pannello ha l'intestazione fissa in alto e solo il corpo scorre.
  - La X è grande 40 px e sempre cliccabile.
  - Esc e Tab agiscono solo sulla modale in cima.
- **Fonti ben visibili.**
  - Il tipo di fonte si sceglie con 4 chip (griglia 2×2), senza più testo troncato.
  - Nome, pagine totali e pagine già snellite hanno etichette vere e una barra di avanzamento.
- **Falso conflitto "salvataggio su un altro dispositivo" con un solo PC.**
  - Causa principale: il salvataggio dall'editor del nodo scriveva sul Cloud senza aggiornare il token di versione, quindi il salvataggio automatico successivo trovava sempre la riga "cambiata".
  - Causa secondaria: due scritture potevano partire insieme, per esempio il salvataggio automatico e il cambio di finestra.
  - Ora esiste una sola coda di scrittura, e ogni salvataggio porta una firma (sessione, dispositivo).
  - Se la versione trovata è la nostra, l'app riprova in silenzio.
  - Il dialogo compare solo per i conflitti veri. Se l'altra versione viene da un'altra finestra dello stesso PC (app installata più browser), il dialogo lo dice.
- **Rientro nell'app.** Tornando sull'app, se qui non ci sono modifiche in sospeso, carica da sola le modifiche fatte sull'altro dispositivo.
- **Recupero dopo una chiusura improvvisa.** Il checkpoint locale ricorda su quale versione era basato: non può più sovrascrivere in silenzio il lavoro salvato nel frattempo da un altro dispositivo.

### Ritmo di carriera e storico della media
- **Il ritmo di carriera** accetta anche la data dell'appello, se è già passata, quando manca quella di verbalizzazione.
  - Se non è calcolabile, spiega quanti esami hanno una data.
  - Attivando "Esame superato" con un appello passato, la data di verbalizzazione viene precompilata.
- **Lo storico della media** mostrava un solo punto: gli esami inseriti già "superati con voto" non venivano registrati.
  - Ora la curva è ricostruita dalle materie del Web-Matrix, con un punto per data e la media cumulata.
  - L'asse è nel tempo reale.
  - Gli esami senza data compaiono in un ultimo punto dichiarato (cerchio vuoto).
  - Cambiare un voto o una data aggiorna subito il grafico.

## 2. Nuova pagina — Empire State University (Lezioni / Sessione)
- **Fase.** È automatica, dalle date del semestre, oppure manuale con una scadenza: *Lezioni* o *Sessione d'esame*.
- **Orario settimanale.**
  - Le materie si scelgono dal Web-Matrix; per ogni lezione si indicano giorno, orario, tipo e aula.
  - L'app avvisa in caso di sovrapposizioni.
  - Si possono segnare i giorni di sospensione.
- **Oggi.**
  - Mostra le lezioni del giorno e la coda delle lezioni da sistemare, cioè quelle senza una sessione Sintesi dopo la fine.
  - Il pulsante "Avvia sintesi" apre direttamente il timer.
- **Stare al passo.** Calcola i minuti di sintesi dovuti per le lezioni già tenute, in base a un rapporto regolabile (da 0,5× a 2×).
- **Collegamenti con il resto dell'app.**
  - **Mission Control:** striscia delle lezioni di oggi. In modalità Lezioni, la priorità "ADESSO" dà la precedenza alle lezioni da sistemare.
  - **Web-Matrix:** badge con le ore di lezione a settimana, e un blocco "stare al passo" nel Piano Appunti.
  - **Sidebar:** badge con la coda e indicatore di fase.
  - **Motore del piano:** in modalità Lezioni, una materia seguita a lezione può prendere l'ultimo posto del focus giornaliero.
  - Eliminare una materia rimuove anche le sue lezioni.

## 3. Algoritmo del piano di studio (verificato e corretto)
- **Soglie e scadenze.**
  - Soglie unificate e controllo cumulativo delle scadenze (EDF): non basta che ogni esame sia fattibile da solo.
  - Un appello già passato ma non verbalizzato non fa più scattare "esame oggi" o la pressione massima: la materia chiede di aggiornare la data o l'esito.
- **Ore di oggi.** Le ore di oggi sono davvero ripartite (`assignedHours`). Le materie senza data non rubano il posto a quelle con esame, e ricevono il tempo avanzato.
- **Calibrazione.**
  - Esclude i nodi chiusi dal verbale e i minuti di sintesi.
  - Esclude gli outlier.
  - Conta oggi solo se hai già studiato.
- **Stime.**
  - Studio stimato prudente: il massimo fra le ore dichiarate e pagine/6.
  - Le materie senza nodi sono stimate dai CFU (15 h/CFU).
  - La sintesi che non ci sta prima dell'esame viene segnalata.
- **Coerenza fra le pagine.**
  - Il Primary Target è allineato fra Web-Matrix, Mission Control e ricompense.
  - La traiettoria segue lo stato delle quote.
  - Il cambio di giorno a mezzanotte aggiorna il piano.
- **Ripassi e laurea.**
  - Gli intervalli dei ripassi Spider-Sense non superano mai il giorno prima dell'esame.
  - La finestra del ritmo di carriera include il semestre di preparazione.
- **Web-Velocity (Star Log)** confronta ora i minuti sulla materia con la quota calcolata dal motore, non più con "nodi × 25 minuti".

## 4. Grafica e usabilità
- **Telefono.**
  - Risolto il bug critico che su telefono lasciava al contenuto ~90 px di larghezza.
  - I nomi di materie e nodi non vengono più troncati (fino a 2 righe), i badge vanno a capo e le righe di azioni si adattano.
  - L'albero dei nodi è compatto sotto i 640 px.
- **Drawer e sovrapposizioni.**
  - I drawer Spider-Sense e Blueprint scorrono davvero, si chiudono con Esc e gestiscono il focus.
  - Last Stand, il flash dei danni e Sensory Zero coprono sempre lo schermo intero.
  - La conferma "Blood Pact" in Sensory Zero è di nuovo visibile.
- **Tastiera.**
  - Esc chiude una conferma senza attivare anche Sensory Zero.
  - Spazio su un pulsante non avvia più anche il timer.
  - Le schede della Suit Lab si navigano con le frecce.
- **Protocolli giornalieri.** Pulsanti più grandi, ed eliminare un protocollo chiede conferma.
- **Dati e impostazioni.**
  - I trofei Vibranium ora compaiono.
  - I campi delle impostazioni si riallineano dopo una sincronizzazione o un import.
  - I timer sono limitati tra 1 e 180 minuti.
  - La bozza del Blueprint non si perde chiudendo subito.
- **Effetti e dettagli grafici.**
  - La modalità "Effetti leggeri" ferma anche le animazioni infinite.
  - L'indicatore delle schede del Nexus Gate è allineato.
  - Il forziere Web-Sling torna al countdown.
  - Il colore dei bordi di stato è rispettato (token `CARD_BARE`).
  - Le variabili di tema non definite sono state sostituite.

## 5. Pulizia
Rimossi codice e stili mai usati:
- funzioni: `toHierarchicalOrder`, `isWakeLockSupported`, `todayPatrolDateKey`;
- classi CSS: `.af-panel`, `.af-hd-border`, `.af-pill`;
- token Tailwind: `af-surface`, `af-border`, `af-glass`, `af-text-secondary`, `shadow-af-panel`;
- import inutilizzati.

## 6. Verifica
- **Test:** 383 automatici, tutti verdi, compresi i nuovi su sincronizzazione, checkpoint, storico, carriera, motore Campus e algoritmo.
- **Resa grafica:** controllata a 360, 768 e 1280 px su tutte le pagine, senza overflow orizzontale e senza errori in console.
- **Simulazione del Cloud** con versioni reali:
  - modifica singola, salvataggio dall'editor del nodo e scritture contemporanee: nessun falso conflitto;
  - aggiornamento al rientro: funziona;
  - conflitto vero: il dialogo compare;
  - ricarica durante il conflitto: nessuna sovrascrittura;
  - recupero dopo una chiusura improvvisa: nessun falso conflitto.

## 7. Da fare a mano
1. `npm install`, poi `npm run check` (lint, test e build).
2. Elimina `.git/index.lock` nella cartella del progetto, se è ancora presente.
3. Supabase: se non l'hai ancora fatto, esegui `supabase/user_data_v6_optimistic_locking.sql`.
4. Supabase → Authentication: chiudi le registrazioni pubbliche.
5. La vecchia passphrase admin era nel codice: cambiala ovunque la usi, e imposta `VITE_ADMIN_PASSPHRASE` su Vercel.
6. **Consiglio:** tieni aperta una sola finestra di ArachnoForge alla volta, cioè l'app installata oppure il browser.
