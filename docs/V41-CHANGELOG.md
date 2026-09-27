# ArachnoForge V41 — La versione definitiva

La V41 rifà da capo l'aspetto dell'app (stessa identità: ArachnoForge, K.A.R.E.N., i nomi a tema, il rosso e il blu del Classic Suit), aggiunge le funzioni che mancavano per usarla ogni giorno senza pensieri e corregge tutti i problemi trovati rileggendo il codice riga per riga. L'obiettivo è rimasto uno solo: aiutarti a studiare, a non rimandare e a tenere in ordine i corsi.

---

## Prima di tutto: cosa fare una volta sola

1. **Controllo completo sul PC.** Nella cartella del progetto:
   ```
   npm run check
   ```
   Esegue ESLint, i 496 test automatici e la build di Vite. Deve finire senza errori; poi pubblica come sempre (Vercel).
2. **Supabase → Authentication → URL Configuration.** Nel campo *Redirect URLs* aggiungi l'indirizzo dell'app (quello di Vercel, per esempio `https://<il-tuo-dominio>/`) e controlla che *Site URL* sia lo stesso. Serve al nuovo "Password dimenticata?": il link dell'email riporta lì.
3. **Consigliato — Supabase → Authentication → Providers → Email → Minimum password length: 10.** L'app chiede già almeno 10 caratteri per ogni password nuova; così lo fa anche il server.

Niente da migrare nei dati: il profilo si carica com'è.

---

## 1. Un aspetto nuovo, la stessa identità

### Il sistema grafico
- **Superfici pulite**: pannelli piatti con bordo sottile e ombra morbida, niente vetro sfocato né aloni al neon dentro le pagine.
- **Un solo colore forte per schermata**: il rosso è l'azione principale, il blu informa, l'oro premia. I costumi (Classic, Symbiote, 2099, Maximum Carnage) continuano a ritingere tutta l'app.
- **Testi in italiano normale**: bottoni e titoli senza maiuscolo spaziato, frasi chiare invece di sigle.
- **Numeri all'italiana ovunque**: `1.830 / 25.000 XP`, `26,61`, `2h 30m` (prima `1830`, `26.61`, `150 min`).
- **Componenti comuni** usati da tutte le pagine: intestazioni, schede, bottoni, campi, badge, cursori, interruttori, controlli a segmenti, finestre, pannelli laterali, avvisi.

### La barra laterale
- Profilo di gioco compatto: livello, XP, streak, token, Stamina e Streak Shield.
- In cima **"Cerca o vai a…" (Ctrl K)**; in fondo lo stato del salvataggio e delle lezioni; accanto al nome la **versione dell'app** (ora `v41.0.0`).
- **Fissa da 1024 px in su.** Sotto diventa un pannello che si apre dal pulsante in alto a sinistra, così su tablet e finestre strette il contenuto ha tutto lo spazio. Chiusa, non si raggiunge per sbaglio col Tab.

### Le pagine
- **Stark-Web Terminal**: la scheda "Adesso" dice cosa studiare, perché e per quanto; durante un blocco diventa la scheda della sessione in corso. Su PC il timer sta a destra; le missioni del giorno sono sempre visibili.
- **The Web-Matrix**: l'albero degli argomenti è subito in vista. A sinistra l'elenco delle materie, compatto e raggruppato per anno, resta fermo mentre scorri. La testata della materia mostra esame, fine prevista (o voto), prontezza con il punto debole, argomenti chiusi e una barra per stato. Sotto i 1200 px elenco e dettaglio stanno uno sopra l'altro, e scegliere una materia ti porta al suo dettaglio.
- **Empire State University**: oggi e lezioni da sistemare in alto, orario settimanale con la linea dell'ora attuale, ritmo per corso, semestri.
- **Daily Bugle Archives**: heatmap di un anno intero con i mesi e i dettagli al passaggio del mouse, numeri chiave, settimana, qualità del Focus, ritmo verso il prossimo esame, radar delle materie e cronologia apribile.
- **Suit Lab & Trophies**: quattro schede (Premi, Skill Tree, Trofei, Blueprint) che si ricordano dove eri. I premi mostrano quanto manca, i trofei sono per livello, i Blueprint sono per materia e si cercano.
- **Karen OS Settings**: indice laterale che segue la lettura; sezioni Profilo, Aspetto, Timer, Suoni e notifiche, Calibrazione, Backup e dati, Avanzate.
- **Multiverse Simulator, Sinister Six Simulator, Suit Telemetry**: ridisegnati con la stessa grammatica, dati più leggibili, controlli più grandi.
- **Nexus Gate** (accesso), **Debriefing**, **AI Index Matrix**, **conflitto Cloud**, **errori di pagina** e **banner Maximum Carnage**: stessa cura del resto.

---

## 2. Funzioni nuove

### Più veloce su PC
- **Palette comandi (Ctrl K / ⌘ K)**: scrivi e premi Invio per andare a una sezione, aprire una materia o un argomento, o comandare il timer da qualunque pagina.
- **Scorciatoie**: `Alt 1…9` per le sezioni, `?` per l'elenco completo; `Spazio`, `Esc` e `D` nel terminale; **`1` `2` `3` nel Debriefing** per valutare la concentrazione senza mouse.
- **Il titolo della scheda del browser mostra il timer** (`▶ 18:42 Focus`, `☕ 04:10 Pausa`, `✓ Sessione da salvare`): lo vedi anche con le slide davanti.
- **Dall'argomento al timer in un click**: "Avvia Focus" nel dettaglio di un argomento, "Ripassa con un blocco di Focus" per quelli da ripassare.
- **Argomenti in serie**: "Aggiungi e scrivi il prossimo" lascia aperta la finestra per inserire i paragrafi uno dopo l'altro.

### Il timer non perde più niente
- **Il blocco in corso sopravvive a un ricaricamento o a un crash.** F5 per sbaglio, il browser che si chiude, il telefono che chiude l'app in secondo piano mentre studi dai tuoi appunti: alla riapertura il blocco riprende da dov'era (in pausa, se l'avevi messo in pausa). Se nel frattempo è finito, i suoi minuti restano da salvare con il Debriefing, con un "Non contarlo" se l'avevi abbandonato.
- **Una sola finestra alla volta.** Con l'app aperta in due finestre (la PWA e il browser, o due schede) lo stesso blocco non viene più contato due volte: la seconda finestra lo dice e aspetta; se chiudi la prima, il blocco riprende nella seconda.
- **I minuti sono quelli veri del blocco**, anche se nel frattempo il timer adattivo di Karen o le Impostazioni cambiano la durata.
- **Pausa da sospendere o da saltare**: "Sospendi" e "Salta la pausa" (nessuna penalità: tornare a studiare prima non costa niente).

### I tuoi dati sono al sicuro
- **Annulla**: eliminare una materia, uno o più argomenti, o annullare un import dell'AI Index Matrix si fa dal messaggio che compare, per qualche secondo.
- **Punti di ripristino** (Karen OS Settings → Backup e dati): una copia automatica al giorno (le ultime 14) e una prima di ogni operazione rischiosa (import, reset, conflitto fra dispositivi, ripristino, eliminazione di una materia). Si creano anche a mano, si scaricano come file e si ripristinano. Vivono su questo dispositivo.
- **Avvio senza rete**: se il Cloud non risponde non vedi più un profilo vuoto come se fosse vero. Compaiono "Riprova" e, se sul dispositivo c'è una copia dei tuoi dati, "Continua offline"; al ritorno della rete l'app riprova da sola.
- **Salvataggi falliti ritentati** ogni 30 secondi e al ritorno della rete; la barra laterale dice subito quando sei offline.
- **Conflitto fra dispositivi più chiaro**: il confronto evidenzia la versione più avanti voce per voce, e quella che scarti finisce fra i punti di ripristino invece di sparire.

### Accesso
- **"Password dimenticata?"**: ricevi un link per email; aprendolo entri e scegli subito la password nuova.
- **"Cambia password"** in Karen OS Settings → Profilo e accesso.
- **Campi password** con "mostra/nascondi" e avviso di **Bloc Maiusc attivo**.
- **Messaggi d'errore chiari** (credenziali errate, email non confermata, troppi tentativi, rete assente…) e **link email scaduti spiegati**.
- **Offline con la sessione scaduta**: appena torna la rete rientri da solo, senza dover rifare l'accesso.

### AI Index Matrix
- **Prompt pronto da copiare** da dare all'IA insieme alla foto dell'indice, con il nome della materia.
- **Incolli la risposta così com'è**: blocchi di codice, frasi prima e dopo, virgolette "tipografiche" e virgole di troppo non sono più un problema.
- Anteprima con capitoli, argomenti, difficoltà e ore; e l'import si annulla con un click.

---

## 3. Problemi corretti

### Dati e sincronizzazione
- Un avvio con il Cloud irraggiungibile mostrava il profilo di default (Livello 1, nessuna materia) come se fosse vero, e il lavoro fatto lì non veniva salvato.
- A ogni avvio partivano toast e suoni "fantasma": nuovo rango, Symbiote sbloccato, missioni completate, Spider-Sense Surge.
- Un errore imprevisto nella verifica della sessione lasciava l'app sulla schermata di avvio per sempre.
- Un backup modificato a mano con voci vuote bloccava l'avvio; due argomenti con lo stesso identificativo si selezionavano ed eliminavano insieme.
- Il dialogo di conflitto diceva "la versione scartata non è recuperabile": ora una copia viene salvata davvero.
- L'app installata (PWA) conservava i file di tutte le versioni precedenti: con la V41 la sua cache riparte pulita.

### Timer e sessioni
- Una pausa sospesa veniva scambiata per un Focus sospeso: "Termina e salva" salvava i minuti di pausa come studio.
- Riprendendo una pausa sospesa partiva il rintocco di fine Focus invece di quello di fine pausa.
- Il recupero di una sessione interrotta poteva arrivare prima dei dati veri del profilo e andare perso.

### Materie, argomenti e ripassi
- Completare un argomento bloccato suonava il chime di un completamento che non avveniva.
- Il Goblin Protocol restava attivo (e bloccante) su un esame appena superato.
- Il piano degli appunti scriveva "scadenza superata" anche per date future.
- La heatmap e il ritmo dello Star Log sbagliavano di un giorno attorno al cambio dell'ora legale.
- Il Doomsday Clock contava fino alla mezzanotte UTC (l'1 o le 2 di notte in Italia): ora scade alla mezzanotte locale.
- Lo Star Log generava chiavi duplicate nella cronologia.

### Premi, simulazioni, telemetria
- Il Reward Shop mostrava "acquistato" anche senza XP sufficienti; premi con nome vuoto o costo non valido venivano accettati.
- Il report della Boss Fight non applicava il ×2 di Maximum Carnage agli XP.
- Senza il briefing del giorno il Readiness appariva "100 · Ottimale": ora dice "da calcolare".

### Accessibilità e comfort
- La rete di particelle del Nexus Gate resta ferma se nel sistema è attivo "riduci movimento".
- Il banner Maximum Carnage respira lentamente invece di lampeggiare per due ore mentre studi.
- La finestra del cambio password porta il cursore sul primo campo.

---

## 4. Verifica

- **496 test automatici, tutti verdi** (erano 415). Nuovi test su: accesso e messaggi d'errore, recupero del blocco in corso e "una sola finestra", AI Index Matrix, numeri all'italiana, punti di ripristino, dati sporchi al caricamento, annullamento di eliminazioni e import, premi dello shop, mezzanotte locale, Goblin Protocol.
- **ESLint: nessun errore e nessun avviso** (erano 156 avvisi, in gran parte falsi allarmi sul JSX).
- **Nel browser**, con un profilo realistico di 18 materie:
  - tutte le pagine a 1440, 1280, 1024, 768 e 390 px, senza errori in console;
  - blocco di Focus ricaricato a metà (ripreso), in pausa (ritrovato in pausa), finito ad app chiusa (minuti da salvare, "Non contarlo" funzionante), con blocchi precedenti in sospeso (sessione ricomposta);
  - due finestre: la seconda aspetta, chiudendo la prima il blocco riprende nella seconda, minuti contati una volta sola;
  - Nexus Gate: accesso, nuovo account, recupero password, rete assente, link scaduto;
  - cambio password, Debriefing da tastiera, AI Index Matrix con risposte "sporche".
- **Una seconda revisione del codice** su timer, accesso e caricamento dei dati; i problemi trovati sono stati corretti e ricontrollati.
- **Da fare sul PC**: la build di Vite (`npm run check`) non si può eseguire in questo ambiente.

## Limiti noti
- La protezione "una sola finestra" usa i Web Locks del browser (Chrome, Edge, Firefox e Safari recenti); sui browser più vecchi c'è una riserva a tempo, meno precisa.
- In Modalità Ospite due finestre aperte sullo stesso browser salvano ciascuna la propria versione: vale l'ultima. Con l'account Cloud il conflitto viene sempre riconosciuto.
