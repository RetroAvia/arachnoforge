# ArachnoForge V40 — Note di rilascio

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
