# Caricamento e scorrimento VIDAA

Verifica del 16 ottobre 2026. Prima delle modifiche alla fluidità sono stati
committati e pubblicati account, Trakt, audio e caratteri nel commit `93fa57bd`.
Quel commit costituisce il riferimento delle prove grafiche sul dispositivo.

## Cause individuate e correzioni

Il precedente limite di 18 richieste copriva soltanto i prefetch separati.
Poster vivi, immagini iniziali e griglie potevano avviare caricamenti attraverso
percorsi differenti; quattro assegnazioni di URL per frame non limitavano il
lavoro ancora in corso nel browser.

Home e griglie condividono ora un massimo di **quattro richieste poster attive**,
compresa la decodifica esplicita quando disponibile. Partono al massimo due
richieste per frame; focus e immagini visibili precedono l'anticipo. Anche le
schede iniziali VIDAA passano dal gestore. Le code obsolete vengono eliminate;
i download pertinenti continuano senza essere riavviati a ogni inversione.
Le richieste non completate hanno una deadline di lifetime, senza introdurre un
ritardo prima dell'avvio. Sono preservati fallback, tentativo di recupero,
cancellazione e isolamento fra schermate. Il precaricamento hero conserva il
suo percorso separato: il limite di quattro non riguarda tutto l'artwork.

Le immagini TMDB delle schede normali sono limitate a **342 pixel per i poster
verticali e 500 per quelli orizzontali**. Le collezioni seguono lo stesso ruolo;
Continua a guardare usa 342 nello stile poster e 500 negli altri stili.
Hero, dettagli e immagine espansa conservano la risoluzione maggiore. Gli URL
di altri provider, compresi quelli firmati, non vengono riscritti.

Il parcheggio precedente conservava ogni sottoalbero staccato. Per le sole
schede statiche generate dal renderer VIDAA vengono ora conservati al massimo
**96 frammenti fuori schermo**; i precedenti possono essere ricreati dal markup
canonico già disponibile. Il ripristino mantiene l'elemento di focus, lo spazio
occupato, le immagini di ripiego riuscite e il confronto incrementale dei dati.
Schede personalizzate, collezioni e contenuti media attivi conservano il proprio
percorso. Anche gli osservatori di immagini ancora differite vengono cancellati.

Questo limita i sottoalberi visuali conservati; **non è una virtualizzazione
completa del catalogo**. Ancoraggi, modello di navigazione, dati e markup restano
disponibili. Togliere `src` rende le bitmap liberabili dal browser, senza imporre
lo svuotamento della cache nativa o misurare la memoria GPU.

## Espansione landscape

L'originale NuvioTVSmart `cee232e5` riserva alla scheda espansa uno spazio maggiore
nella riga. Il fork VIDAA manteneva lo spazio portrait e allargava soltanto il
riquadro sovrapposto: causa della copertura delle schede vicine segnalata.

La scheda VIDAA riserva ora la propria larghezza espansa nel flex della riga,
spostando le schede successive. L'apertura anima soltanto le trasformazioni
della superficie e delle schede vicine per 180 ms; la larghezza cambia una volta.
La camera viene compensata anche sugli ultimi elementi, con un margine interno
allo schermo e senza scrollare gli antenati. Il portrait originale mantiene
le proprie dimensioni finché lo sfondo landscape non è pronto.

Il test locale in Chrome copre **30 combinazioni** portrait/landscape, dimensioni,
bordi, viewport ristretti, righe corte e ultimo elemento. Controlla separazione
dalle schede vicine anche durante l'animazione, nessun taglio laterale,
interruzione con D-pad, ridimensionamento e append della pagina successiva.
Aggiornamenti incrementali, rimozione della scheda, sostituzione della Home e
uscita ripuliscono animazioni e listener; un aggiornamento della scheda durante
l'apertura conserva il nodo del portrait e il focus.

## Avvio iniziale

È stato riprodotto localmente un blocco nella priorità dei cataloghi: i primi
cinque slot VIDAA seguivano l'ordine dei manifest, compresi cataloghi disabilitati.
Una riga configurata in cima alla Home ma successiva nel manifest non veniva
richiesta finché l'intero primo batch non terminava (o scadeva il timeout di
3.500 ms). Ora filtro e ordine Home vengono applicati prima di pianificare
le richieste. Le collezioni mantengono il loro ordinamento e i cataloghi
disabilitati non consumano richieste o slot iniziali.

Il gate iniziale teneva inoltre nascosta tutta la Home finché Continua a
guardare non rispondeva, anche con cataloghi già pronti, fino al limite di
cinque secondi. Su VIDAA una riga riuscita con elementi reali può ora mostrare
la Home navigabile, conservando il placeholder e lo stato pendente dei progressi.
Righe vuote, errori e schede di caricamento non sbloccano la schermata.
Il test con progressi differiti verifica il loro successivo aggiornamento e
che un utente già attivo mantenga focus e hero; senza interazione rimane
il focus iniziale previsto su Continua a guardare. Le altre piattaforme
mantengono il gate precedente.

Inoltre, il completamento dell'ultimo catalogo iniziale eseguiva un render
diretto, anche se la prima riga era già comparsa e l'utente stava navigando.
Su VIDAA passa ora dallo stesso render coalescente e protetto dall'attività
di navigazione. Le regressioni simulano risposte parziali lente e input durante
il completamento; nessun ritardo fisso aggiuntivo è stato introdotto.

## Immagini reali

Sei richieste al CDN pubblico TMDB hanno restituito HTTP 200 e JPEG validi.
Misure su due file reali, senza credenziali o endpoint privati:

| Immagine |                   w1280 |                  w500 |                 w342 |
| -------- | ----------------------: | --------------------: | -------------------: |
| Poster   | 486.358 byte, 1280×1920 | 102.588 byte, 500×750 | 50.280 byte, 342×513 |
| Sfondo   |  204.833 byte, 1280×720 |  37.448 byte, 500×281 | 19.314 byte, 341×192 |

Sono dimensioni e byte verificati, non misure di RAM del televisore.
La riduzione teorica dell'area è del 53,2% da 500 a 342 e dell'84,7% da 1280 a
500, a parità di rapporto. Gli still degli episodi non sono stati verificati
separatamente; il percorso Continue Watching già usava il limite 500.

## Prove e limiti

- 83 suite VIDAA passate sul codice finale, comprese priorità dei cataloghi,
  gate con progressi differiti e completamento durante la navigazione.
- 10 fixture Chrome passate, comprese Home, Catalogo/Discover, focus, ritorno,
  immagini di ripiego, espansione preesistente e aggiornamenti incrementali.
- Il test griglia attende immagini effettivamente pronte mantenendo il tasto
  premuto: controlla avanzamento, focus e limite concorrente, anziché pretendere
  che tutte le immagini finiscano nello stesso frame prestabilito.
- CDN, browser desktop e TV sono verifiche distinte.

Il confronto TV usa il renderer Home, gli stili compilati, il percorso D-pad,
la paginazione locale e immagini pubbliche reali: 59 titoli, 58 poster/sfondi
distinti e 12 righe con 48 elementi disponibili. I tre passaggi sono avanzamento,
inversione e nuovo avanzamento. Cataloghi autenticati, player e arricchimento
remoto dei metadata sono esclusi per isolare il lavoro grafico.

Il primo percorso di prova è stato corretto perché troppe frecce sinistre
entravano nella sidebar. Le fasi successive di quel percorso sono escluse dal
confronto; sono utilizzati soltanto i run marcati `scenarioVersion: 2`.
La pagina diagnostica e la memoria dell'account di produzione sono separate.

Gli intervalli fra callback `requestAnimationFrame` indicano disponibilità del
thread, non frame effettivamente presentati dalla GPU. La durata del gestore
D-pad è sintetica e non misura il ritardo del telecomando fisico. Le statistiche
escludono il proprio costo di raccolta. La cache HTTP non è stata cancellata:
il primo passaggio non certifica un avvio a cache vuota. La misura di heap JS,
quando esposta dalla TV, non rappresenta tutta la RAM del processo.

La sola baseline TV completata (`93fa57bd`) ha prodotto 260,1 secondi di
navigazione, focus finale corretto e nessun errore JavaScript o immagine.
La mediana del p95 degli intervalli RAF per finestre da dieci secondi era
66,66 ms in tutti e tre i passaggi; gli intervalli oltre 50 ms erano 5,15%,
7,60% e 11,31%. Sono stati conservati fino a 6.274 nodi visuali, compresi
5.230 nei frammenti parcheggiati. Questo documenta il costo del comportamento
precedente, senza attribuire alle correzioni un miglioramento TV non misurato.

**Le prove sul dispositivo sono state sospese su richiesta dell'utente.**
L'avvio a freddo, la fluidità sostenuta e la nuova espansione devono ancora
essere valutati sulla TV con il pacchetto aggiornato. Le verifiche Chrome e
le simulazioni automatiche non certificano FPS o memoria del dispositivo.
Il pacchetto finale è `dist/nuvio-vidaa.zip`; non contiene harness diagnostici,
credenziali personali o URL privati delle sorgenti.
Build `99edcec89f079904`, 7.752.100 byte, 173 file, configurazione Trakt presente.
SHA-256: `e0f62bd150c8edb5f3ba8103c7a7b6494167595ef11a28ec51c3f47b91e1d2fd`.
Build, lint e verifica di formattazione completati senza errori.

## Build pubblica e Trakt

La verifica del primo push ha rilevato una configurazione Trakt incompleta sul
sito pubblico, benché il pacchetto locale fosse configurato. Vercel prepara ora
la configurazione applicativa dalla release ufficiale con checksum fissato
prima del packaging. Una coppia esistente completa viene conservata; una coppia
parziale incompatibile provoca errore senza sovrascrittura. Nessun valore viene
committato o stampato. Rimane necessaria l'approvazione del codice dispositivo
da parte dell'utente per collegare il proprio account Trakt.
