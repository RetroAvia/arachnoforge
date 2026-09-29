# ArachnoForge V42 — Organizza tutto lo studio

La V42 trasforma ArachnoForge da diario dello studio a **piano di studio vero**: un solo calendario per tutti gli esami, che sa quanto studi davvero, quando iniziare ogni materia, quando chiudere gli appunti, quando ripassare e cosa succede se non ci stai dentro. Intorno al piano, la memoria degli argomenti (Spider-Sense) e la prontezza d'esame misurano il ricordo e non i click; K.A.R.E.N. ragiona sul piano del giorno; la gamification premia solo lo studio vero e il riposo, mai la notte. Stessa identità, stessi nomi a tema.

---

## Prima di tutto: cosa fare una volta sola

1. **Supabase → SQL Editor**: esegui `supabase/karen_v8_governance.sql` (dopo la v7, già presente dalle versioni precedenti). Crea i contatori di tutte le modalità di K.A.R.E.N. e la tabella del bilancio settimanale. Si può rieseguire senza errori.
2. **Il secret dell'allowlist, obbligatorio.** Da questa versione K.A.R.E.N. risponde solo agli account elencati:
   ```
   supabase secrets set KAREN_ALLOWED_EMAILS=la-tua-email@esempio.it
   ```
   (in alternativa, o in aggiunta, `KAREN_ALLOWED_USER_IDS` con il tuo user id). Senza il secret l'app mostra "K.A.R.E.N. non è ancora abilitata per nessun account".
3. **Pubblica la funzione aggiornata**:
   ```
   supabase functions deploy karen-oracle
   ```
4. **Consigliato — Supabase → Authentication → Sign In / Providers**: disattiva le nuove registrazioni. L'app è tua sola: nessuno deve potersi creare un account sul tuo progetto.
5. **Controllo completo sul PC**, poi pubblica come sempre (Vercel):
   ```
   npm run check
   ```

**I dati si aggiornano da soli** (schema 13.0.0) al primo avvio:
- le date d'esame diventano **appelli** (scritto e orale), senza perdere niente;
- il **livello** si ricalcola sulla nuova curva con **gli stessi XP totali**: sale (per esempio dal Lv 14 al Lv 25) e ricevi **un Tech Token per ogni livello nuovo**. Il Combat Log lo annota. Gli XP da spendere nel Reward Shop non cambiano;
- i ripassi passano al nuovo modello di memoria partendo dalle date che avevi.

---

## 1. Il piano di studio: tutte le materie insieme

### Web-Swing Route (nuova pagina, `Alt 0`)
Il percorso fino agli esami, giorno per giorno. Per ogni materia: **inizia entro**, **appunti chiusi entro**, **fine prevista**, il lavoro che resta (sintesi, studio, ripasso finale) e le **finestre del ripasso finale**. In testa le ore medie al giorno, il lavoro totale e gli esami in piano.

### Un solo piano, con la capacità vera
- **Quanto studi davvero**: la capacità si misura sui giorni già chiusi (mai su oggi a metà), per giorno della settimana e separata fra periodo di lezioni e sessione. Finché i dati sono pochi si parte da 4h 30m al giorno e si passa gradualmente ai tuoi numeri; nei giorni con lezioni in aula la parte non ancora misurata cala. In Karen OS Settings → **Piano di studio** puoi fissare le ore a mano e scegliere i **giorni di riposo**.
- **La giornata di oggi**: prima i ripassi dovuti (al massimo metà della giornata: un arretrato scivola sui giorni dopo), poi il **minimo per restare in tempo** con tutti gli esami, poi le lezioni da sistemare (fino al 40% della giornata; se un esame è a rischio passano dopo il suo minimo, e nei 10 giorni prima di un esame la riserva si sospende), poi l'anticipo su al massimo **due materie**.
- **Quello che fai consuma l'obiettivo, non lo rimpicciolisce**: il piano parte da inizio giornata e le ore fatte si scalano.
- **Mai studio programmato dopo un esame**: il lavoro che non ci sta è **ritardo**, dichiarato come "ore scoperte all'esame", e la fine prevista si stima oltre la data.
- **Due materie in parallelo solo se la più vicina resta in tempo**: prima due esami lontani si dividevano la giornata e il primo finiva in ritardo.
- **Un numero solo per il ritardo**: le ore scoperte agli esami sono le stesse nello Stark-Web Terminal, nel pannello di oggi, nella Web-Swing Route e nel contesto che riceve K.A.R.E.N.
- **Materie senza argomenti**: stima dai CFU (15 ore per CFU) meno lo studio già fatto sulla materia.
- **Propedeuticità ragionate**: una propedeutica con l'appello **prima** dell'esame che la richiede non congela più la materia. Corretta la mappa del corso (Aerodinamica: Analisi 1 e Algebra; Inglese è un'idoneità).

### "E se…?": gli scenari
Quando il piano non sta nei tempi, la Web-Swing Route ricalcola il piano **vero** cambiando una cosa sola: spostare una materia all'appello successivo, toglierla da questa sessione, un'ora in più al giorno. Per ognuno: ore scoperte e materie critiche, prima e dopo.

### Gli appunti col tuo metodo
- **Resa per tipo di fonte**: da 100 pagine di libro ne ricavi 2 di appunti, da 100 slide 5, da 100 pagine di appunti del docente 8. Esempio: 1000 pagine di libro + 300 slide ≈ **35 pagine tue** (prima la stima era 234). Appena chiudi qualche sintesi, conta la tua resa.
- **Ritmo per tipo di fonte**: le slide si leggono più in fretta dei libri, e il piano lo sa.
- La **data di chiusura degli appunti** si calcola su tutte le materie insieme, in ordine di esame.
- In periodo di lezioni, una lezione non sistemata resta in coda **due settimane** come arretrata invece di sparire.

---

## 2. Appelli, esercizi, simulazioni, orale

- **Appelli**: più date per materia, con **scritto e orale**; scegli l'appello obiettivo. **Formato d'esame**: scritto + orale, solo scritto, solo orale, progetto + orale, idoneità. Fra scritto e orale il piano prepara l'orale.
- **"Com'è andata?"**: dopo l'ultima prova dell'appello scegli **superato**, **non superato** (si passa all'appello dopo) o **aspetto l'esito**.
- **Esercizi**: nuovo modo di lavoro "Esercizi" nel timer, con esercizi fatti e corretti nel Debriefing; si registrano anche quelli fatti su carta.
- **Simulazione d'esame**: registri punteggio e durata di una prova completa a tempo. La **Sinister Six Simulator** si lega a una materia e dà XP in base al tempo (almeno 20 minuti).
- **Interrogazione K.A.R.E.N. registrabile**: per ogni domanda segni *sapevo / a metà / no*; sugli argomenti completati l'esito vale come ripasso.
- **Interrogazione orale (nuova)**: una domanda alla volta, come all'esame. Rispondi per scritto e K.A.R.E.N. ti dice esito, voto su 10, cosa hai coperto e cosa manca; oppure rispondi a voce e ti giudichi sui punti chiave. L'esito si registra argomento per argomento.
- **Ricomincia da zero**: per le materie che ricostruisci in sessione. Gli argomenti si riaprono, i minuti già fatti restano nello storico, puoi scegliere di rifare anche gli appunti; nessun XP pagato due volte.

---

## 3. Memoria e prontezza d'esame

- **Spider-Sense con FSRS**: ogni argomento ha stabilità e difficoltà sue e quattro voti (*non ricordavo, difficile, bene, facile*). Il primo ripasso cade dopo 1, 2 o 3 giorni. Prima dell'esame i ripassi si distribuiscono in tre finestre (21–15, 10–6 e 4–1 giorni prima), nel giorno meno carico: niente più trenta ripassi tutti alla vigilia. Si può ripassare in anticipo.
- **Prontezza d'esame su quattro pilastri**: copertura (solo lo studio vero) 40%, memoria (quanto ricordi oggi degli argomenti chiusi) 30%, pratica (esercizi e simulazioni, per gli esami con scritto) 15%, fattibilità del piano 15%. Un pilastro senza dati non vale zero: resta fuori, e la **confidenza** lo dichiara. "Pronto" solo con copertura almeno al 90%, memoria almeno al 75% e dati sufficienti.
- I **minuti di ripasso** si contano a parte e non falsano più la calibrazione dello studio.

---

## 4. K.A.R.E.N.

- **Il briefing conosce il piano di oggi**: materie, obiettivi, ripassi, lezioni, fase del semestre. Sceglie gli argomenti dentro il piano, sa cosa hai fatto ieri e se hai seguito il consiglio.
- **Readiness "non misurata"** quando i dati sono troppo pochi (meno di due voci del punteggio): nessuna correzione del carico e timer tuo, invece di un falso "100 · Ottimale".
- **Piano di ripiego dichiarato** quando Claude non risponde, con **"Riprova con Karen"**: un nuovo tentativo che non consuma le rigenerazioni (al massimo uno ogni due minuti).
- **Bilancio della settimana** (Daily Bugle Archives): minuti contro obiettivo giorno per giorno, materie e modi di lavoro, energia della sera, ripassi ed esercizi, esami in arrivo. K.A.R.E.N. risponde come una tutor: cosa ha funzionato, cosa cambiare, una tecnica di studio con il come, le priorità della settimana dopo. Un bilancio scritto a settimana in corso si aggiorna quando la settimana finisce.
- **Sonno**: il bersaglio non scende mai sotto le 7h 30m (se dormi di più lo alza, fino a 9h): due settimane di notti corte non diventano "normali".
- **Sicurezza e costi**: solo gli account dell'allowlist; un tetto giornaliero per ogni modalità, contato sul giorno del server (cambiare la data del telefono non azzera niente); date accettate solo entro un giorno da oggi; modello di riserva se quello configurato non esiste; i tuoi testi arrivano a Claude come dati, mai come istruzioni; nei log nessun testo né dato di salute.

Tetti al giorno: 6 briefing nuovi, 20 rigenerazioni, 12 nuovi tentativi dopo un ripiego, 30 interrogazioni, 20 orali, 80 valutazioni di risposte, 6 bilanci settimanali.

---

## 5. Contro il rimandare

- **"Adesso"** segue la sequenza della giornata: il blocco deciso ieri sera, i ripassi dovuti, poi le materie del piano con l'argomento e il modo di lavoro giusti. **"Solo 5 minuti"** quando partire è la parte difficile.
- **"Chiudi la giornata"**: un minuto la sera per il bilancio (minuti, energia) e per scegliere il primo blocco di domani con l'ora. La mattina lo trovi pronto in "Piano di ieri sera": si parte con un click.
- **Missioni del giorno per fase**: lezioni e appunti durante i corsi, esercizi e simulazioni in sessione. Contano solo blocchi veri (almeno 20 minuti) e ripassi dovuti.

---

## 6. Gamification allineata allo studio

- **Nuova curva dei livelli**: i primi livelli arrivano prima, quelli alti restano un traguardo (Lv 50 a circa 760.000 XP totali, prima 4,7 milioni).
- **Serie di studio**: un giorno vale con almeno **25 minuti di Focus**; ogni settimana hai **2 giorni di riposo** (da 0 a 3, in Impostazioni) che non rompono la serie; gli Streak Shield servono solo oltre i riposi.
- **Maximum Carnage**: 5 azioni critiche nello stesso giorno danno **una carica**, che attivi tu fra le 6 e le 23; dura 2 ore e la Stamina scende normalmente.
- **XP solo per eventi veri**: il completamento di un argomento si paga una volta (e si toglie se lo riapri); un ripasso vale solo se era dovuto; lo Spider-Sense Surge è proporzionale e parte da 20 minuti; il bonus Overdrive vale solo sul blocco in più; i protocolli danno al massimo 30 XP ciascuno, 60 XP e 40 Stamina al giorno.
- **Stamina in proporzione alla tua giornata**, e le pause la ricaricano.
- **Tech Token per ogni nuovo livello massimo**, da qualunque fonte di XP (perdere e riprendere un livello non paga due volte); un Web-Sling RARE vale un token; il Blood Pact dice la penalità vera.
- **Niente premi notturni**: tolte missioni, skill e trofei che premiavano lo studio di notte (la skill notturna è diventata "rigenerante"). Nel Debriefing la qualità del Focus non sposta più gli XP: dirla com'è non costa niente.

---

## 7. Media e laurea

- La **media ponderata** esclude idoneità e sovrannumerari anche se per errore portano un voto; i CFU a scelta formano un blocco unico; una materia già in piano non si aggiunge due volte.
- **Voto di laurea con la formula del regolamento**: 11·m/3 più i punti per la media, per la durata degli studi, per la tesi (0–2) e per l'Erasmus, arrotondato all'intero. Anno di immatricolazione ed Erasmus si impostano in Karen OS Settings → Piano di studio.
- Il **what-if** propone solo esami del piano, con voto e non bloccati dalle propedeuticità.

---

## 8. Problemi corretti

### Piano e calendario
- La capacità si usava anche non calibrata e **calava dopo la prima sessione del giorno**; l'obiettivo di oggi non finiva mai.
- In sovraccarico le ore andavano in proporzione invece che per scadenza, e una materia congelata dalle propedeuticità spariva dal carico.
- Un appello già passato restava "Event Horizon"; "Adesso" ignorava il piano; i ripassi dovuti non erano pianificati ma gonfiavano la capacità.
- La scadenza "inizia entro" poteva essere decisa da un ripasso finale lontano invece che dallo studio.
- Il ritardo del piano mostrava due numeri diversi fra Stark-Web Terminal e Web-Swing Route.

### Memoria e prontezza
- La prontezza misurava click e ore di sintesi: una materia solo riassunta risultava "Pronta"; senza ripassi o dopo mesi di abbandono non calava.
- Il tetto all'esame metteva tutti i ripassi alla vigilia e ne cancellava la storia; "difficile" valeva come "dimenticato"; alcuni argomenti tornavano ogni giorno per sempre; spostare l'esame non ricalcolava i ripassi.

### K.A.R.E.N.
- Nessun tetto alla spesa per l'IA e contatori azzerabili cambiando la data del dispositivo.
- I ripassi dovuti sparivano dal briefing; una data d'esame passata vinceva il focus; con un solo dato il Readiness diceva 100.
- Le direttive di un altro giorno restavano attive; un ripiego poteva sovrascrivere un briefing buono; con un nome di modello sbagliato ogni chiamata falliva in silenzio.
- "Il consiglio di ieri" poteva venire da un briefing di giorni prima; un bilancio di metà settimana veniva servito come definitivo.
- Un'interrogazione orale chiusa poteva mostrare, in ritardo, le domande di un'altra materia.

### Gamification e media
- XP senza studio: vittorie della Boss Fight al primo secondo, argomenti completati e riaperti a ripetizione, ripassi dello stesso argomento a raffica, protocolli da 500 XP.
- Overdrive moltiplicava l'intera catena; Maximum Carnage partiva da solo a qualunque ora e senza costo di Stamina; lo studio notturno era premiato.
- Un giorno di riposo azzerava la serie, mentre un minuto al giorno la teneva viva.
- Un 18 su Inglese abbassava la media; il voto di partenza diceva 100,6 invece di 100,7; il what-if proponeva idoneità ed esami bloccati.
- Livelli ripresi dopo un Blood Pact pagavano di nuovo il token; il Blood Pact annunciava sempre −50.

### Dati e testi
- Un salvataggio corrotto con un contatore non numerico (livello, XP, Stamina…) o voci vuote in premi, inventario, trofei e missioni poteva rompere i calcoli: ora torna ai valori di default.
- Etichette al singolare dove serviva ("1 risposta completa", "1 lezione") e "il Boss si sblocca a 0" riscritto come "ne manca 1 per il Boss".

---

## 9. Verifica

- **770 test automatici, tutti verdi**: 672 dell'app (erano 496 nella V41) e 98 della funzione K.A.R.E.N. Nuovi test su piano globale, scenari, appelli, serie di studio, Maximum Carnage, missioni del giorno, media e laurea, "Adesso", contesto del piano per K.A.R.E.N., dati corrotti al caricamento.
- **ESLint pulito**; la funzione K.A.R.E.N. passa il controllo di TypeScript in modalità rigorosa.
- **SQL v8 provato su Postgres 16**: due esecuzioni di fila, contatori atomici, tipo sconosciuto rifiutato, nessun accesso dal client.
- **Prove automatiche con dati casuali**: 400 piani con materie incomplete o sporche e 300 profili corrotti, senza errori né valori non numerici.
- **Nel browser**, con un profilo realistico: tutte le pagine a 1440 e 390 px senza scorrimento orizzontale; con un backend finto, Readiness non misurata, piano di ripiego e "Riprova con Karen", bilancio della settimana (anche l'aggiornamento a settimana finita) e interrogazione orale dall'inizio alla registrazione.
- **Una revisione indipendente** della funzione K.A.R.E.N.: i sei problemi trovati sono stati corretti e ricontrollati.
- **Da fare sul PC**: la build di Vite (`npm run check`) non si può eseguire in questo ambiente; qui la build è stata verificata con esbuild e Tailwind.

## Limiti noti
- La capacità misurata ha bisogno di qualche settimana di uso normale per essere precisa; fino ad allora il piano si appoggia in parte al valore di partenza, e lo dice.
- Il bilancio settimanale e l'interrogazione orale richiedono l'accesso con l'account Cloud (non funzionano in Modalità Ospite).
- Il ripasso finale ha la precedenza sullo studio nuovo nelle sue finestre: con una materia molto in ritardo, il piano consolida quello che hai già studiato invece di coprire tutto.
