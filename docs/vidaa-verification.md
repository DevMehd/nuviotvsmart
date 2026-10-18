# Verifiche VIDAA

Rapporti delle verifiche del 16 ottobre 2026. Conteggi, hash e pacchetti descrivono le singole sessioni storiche; per verificare il checkout corrente usare i comandi nella sezione seguente.

- [Account, progressi e Trakt su VIDAA](#account)
- [Audio VIDAA: correzioni e verifiche del 16 ottobre 2026](#audio)
- [Caricamento e scorrimento VIDAA](#fluidity)
- [Sorgenti VIDAA: caratteri e lingua](#sources)

## Eseguire le verifiche correnti

- `npm run test:vidaa`: tutte le suite VIDAA riproducibili in `tests/`, rilevate automaticamente dal runner.
- `npm test`: build e controlli dei trasporti/plugin condivisi.
- `node tests/run-vidaa-home-dom-tests.mjs`: le dieci fixture DOM con Chrome o Edge.
- `npm run lint` e `npm run package:vidaa`: controlli statici e pacchetto.

Le suite restano separate per comportamento per individuare le regressioni; non sono risultati di esecuzioni da archiviare. Le prove manuali del firmware e l’ascolto sulla TV mantengono i limiti descritti nei rapporti.

<a id="account"></a>

## Account, progressi e Trakt su VIDAA

Verifica del 16 ottobre 2026. Fork: `Empi9245/nuviotvsmart`, base locale
`19fd6c76`. Riferimento ufficiale:
[`NuvioMedia/NuvioTVSmart`](https://github.com/NuvioMedia/NuvioTVSmart), commit
`cee232e571fa01a3175b2798e5c7bc513f476f65`, confermato anche come HEAD remoto.

### Diagnosi e correzioni

Il servizio `watchProgressSyncService.js` iniziale era identico al riferimento.
Non sono stati sostituiti i contratti API, il mapping dei progressi o le regole
di scelta Nuvio/Trakt/Simkl. Le anomalie riprodotte riguardavano soprattutto
l'orchestrazione, alcune presenti anche nel riferimento ufficiale:

- Il percorso autenticato decideva se mostrare la scelta del profilo usando
  l'elenco locale, prima di leggere i profili dell'account. Adesso li carica
  prima della decisione e scarta una decisione completata da una sessione obsoleta.
- Il percorso di sincronizzazione dopo un avvio recente non esponeva la stessa
  promessa di caricamento attesa dalla Home. Ora avvio caldo e freddo condividono
  quel percorso; una richiesta di un nuovo profilo aspetta quella precedente e
  conserva la propria identità.
- Errori catturati internamente dai servizi di lettura venivano interpretati
  come un ciclo riuscito. Ora il coordinatore verifica anche lo stato effettivo
  e non registra un successo dopo un errore di lettura o di scrittura.
- Un progresso salvato localmente prima della chiusura poteva attendere il
  successivo ciclo periodico/foreground per essere scritto. Ora un pull valido
  che rileva modifiche locali pendenti ne avvia la riconciliazione al riavvio.
  Errori, fonte alternativa o snapshot remoto vuoto conservativo non provocano
  questa scrittura automatica.
- Due push contemporanei di profili diversi restituivano entrambi successo,
  ma poteva partire solo il primo. Ora le richieste pendenti sono distinte per
  profilo. Questa è la modifica circoscritta al servizio progressi.
- La Home conserva i cambi applicati fra i tentativi e riceve l'aggiornamento
  anche se una scrittura successiva fallisce. Il risultato del ciclo resta
  fallito e può essere ritentato; la notifica dei dati non equivale a un successo.

Non sono stati modificati player, telecomando, cache delle immagini o adattatori
VIDAA. I dati locali e i token Trakt esistenti non vengono rimossi dalla modifica.

### Collegamento Trakt

Il fork aveva introdotto configurazioni Client ID/Secret per profilo e relativi
campi TV. Un override incompleto poteva nascondere la configurazione dell'app.
La UI ora usa il collegamento originale a codice dispositivo e la configurazione
applicativa del pacchetto. Le vecchie impostazioni locali sono lasciate intatte,
ma non sostituiscono più i valori della build.

La configurazione applicativa è stata importata dalla
[release ufficiale 1.2.5](https://github.com/NuvioMedia/NuvioTVSmart/releases/tag/1.2.5)
nel file ignorato `local.properties`; nessun account o token utente vi è stato
salvato. Per riprodurre una build configurata:

```sh
node scripts/import-official-trakt-config.mjs
npm run package:vidaa
```

L'importatore usa l'asset Tizen ufficiale con SHA-256 fissato, estrae soltanto le
due impostazioni Trakt, preserva le altre proprietà e non stampa i valori.
Il codice applicativo della release non viene copiato nel fork.

Anche il deploy Vercel prepara ora la configurazione con `--if-missing` prima
di generare il pacchetto: un checkout nuovo non dipende dal file locale ignorato
presente sul computer di sviluppo. Una coppia Client ID/Secret già valida viene
conservata senza richieste di rete, anche per un'app personalizzata. Una coppia
parziale incompatibile resta intatta e blocca la build; download o verifica SHA-256
falliti bloccano ugualmente il deploy. Il percorso `NUVIO_LOCAL_PROPERTIES`, se
configurato, è rispettato sia dalla preparazione sia dalla build. I test della
preparazione usano un archivio sintetico in una cartella temporanea e generano il
file runtime con lo stesso passaggio impiegato dalla build, senza valori reali.

### Verifiche reali completate

Login eseguito con l'account autorizzato. Password e token sono rimasti in memoria
del processo diagnostico; non sono stati scritti in sorgenti, log applicativi
o pacchetto. Non sono stati cambiati profili, impostazioni o collegamenti esistenti.

| Prova                         | Riscontro                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login ufficiale               | `/auth/v1/token`: 200; sessione legata a `https://api.nuvio.tv`                                                                                                 |
| Account e profili             | `sync_pull_profiles` e `get_sync_owner`: 200; tre profili esistenti                                                                                             |
| Lettura progressi per profilo | `sync_pull_watch_progress`: 200; 699, 124 e 20 record remoti                                                                                                    |
| Mapping locale                | 698, 124 e 20; il primo profilo contiene un record con durata sotto 60 secondi, escluso dalla regola upstream invariata                                         |
| Scrittura e aggiornamento     | Progresso sintetico identificabile scritto a 123000 ms, poi aggiornato a 234000 ms; push 204, riletture 200 e repository a 234000 ms                            |
| Conservazione dati            | Test effettuato con snapshot originale completo; eliminato solo l'elemento creato dal test, delete 204; i 699 record originali risultano identici dopo la prova |
| Rinnovo sessione              | Refresh ufficiale 200, accesso e refresh token utilizzabili                                                                                                     |
| Ripristino sessione           | Nuovo bootstrap dello stato auth dalla memoria locale simulata: autenticato e profilo conservato                                                                |
| Trakt in Chrome               | Codice dispositivo generato, `/oauth/device/token` restituisce attesa approvazione; nessun campo Client ID/Secret nella UI                                      |

Il client Node ha ricevuto un 403 HTML da Cloudflare per Trakt. Il percorso reale
in Chrome è riuscito e ha raggiunto `pending`; non è stata aggirata alcuna
approvazione dell'utente. Il codice temporaneo del test non va usato per collegare
la TV: generarne uno dalla TV conserva il collegamento nel dispositivo corretto.

La prova del browser con la sessione Nuvio autenticata non è stata eseguita:
la revisione automatica ha rifiutato il trasferimento dei token a una pagina
locale. Le prove API reali Nuvio e le prove DOM con backend simulato sono distinte.

### Verifiche automatiche

- `npm run test:vidaa`: **78 suite PASS**, incluse nuova suite account/progressi/
  lifecycle, 28 verifiche Trakt e importazione della configurazione.
- `node tests/run-vidaa-home-dom-tests.mjs`: **10 fixture PASS in Chrome**:
  aggiornamento Home, focus, ritorno, finestre immagini, paginazione, account,
  raccolte e trailer. Backend account simulato.
- `node scripts/test-webos-plugin-forwarding.cjs`: **PASS**; esecuzione con
  connessioni locali abilitate, necessarie anche per il runner DOM.
- `npm run lint`, lint mirato degli ultimi file e `git diff --check`: **PASS**.
- `npm run package:vidaa`: **PASS**.
- ZIP estratto in memoria e controllato: credenziali dell'account, access token,
  refresh token ed email assenti; configurazione Trakt presente; nessun file
  diagnostico, test o `local.properties` nel pacchetto.

### Pacchetto e prove ancora necessarie sulla TV

Pacchetto intermedio della sola verifica account: 7740976 byte, 173 file.
Build VIDAA: `0e9bda7e0df28761`.
SHA-256: `0bf9b267cad6289a43f8e54c48f6533a122e400a370da32dde44310507bec804`.
È stato successivamente sostituito dall'archivio completo
`dist/nuvio-vidaa.zip`, che comprende anche audio e sorgenti; dettagli in
[Sorgenti VIDAA: caratteri e lingua](vidaa-verification.md#sources).

1. Aggiornare mantenendo indirizzo/origine di installazione e dati dell'app.
   Verificare i tre profili ufficiali e l'opzione di ricordo dell'ultimo profilo.
2. Riprodurre un contenuto, tornare alla Home e confrontare posizione/episodio
   su un altro dispositivo Nuvio con lo stesso profilo. Eseguire anche il percorso
   inverso, dall'altro dispositivo alla TV.
3. Cambiare profilo durante una sincronizzazione; verificare l'isolamento di
   Continua a guardare. Chiudere e riaprire, poi sospendere e riattivare la TV.
   Verificare anche il rinnovo automatico di una sessione scaduta sul runtime VIDAA.
4. In Impostazioni → Integrazioni → Trakt, scegliere Connetti e approvare il nuovo
   codice su `https://trakt.tv/activate`. Verificare cronologia, ripresa,
   scrobbling e persistenza del collegamento dopo cambio profilo/riavvio.

Per account e progressi restano da eseguire le prove sul runtime VIDAA installato
elencate sopra e lo scrobbling reale dopo approvazione Trakt. Le successive
prove audio e caratteri sulla TV sono documentate nei rispettivi rapporti;
non sostituiscono il confronto dei progressi fra dispositivi.

<a id="audio"></a>

## Audio VIDAA: correzioni e verifiche del 16 ottobre 2026

Confronto con NuvioTVSmart ufficiale `cee232e5` e con il fork prima delle
correzioni audio. Le modifiche account/Trakt precedenti sono conservate.

### Cause riprodotte nel codice

1. Il fallback iniziale trattava una selezione audio asincrona come già
   completata. Poteva rilasciare il gate prima della conferma e avviare richieste
   sovrapposte. Ora mantiene la stessa richiesta pendente fino alla conferma
   esistente, anche se scade la finestra di discovery. Nessun nuovo ritardo.
2. La selezione nativa disabilitava la traccia precedente prima di attivare
   quella nuova. Se il firmware accettava il primo comando ma rifiutava il
   secondo, tutte le tracce restavano disabilitate: riprodotto con il vero
   controller e setter simulati. Su VIDAA il fallimento ripristina ora gli
   stati precedenti, soltanto se sorgente, motore, oggetti e richiesta sono
   ancora correnti. La selezione continua a restituire fallimento. Non riscrive
   ripetutamente il comando rifiutato e non memorizza un falso successo.
3. Una voce audio già visualizzata poteva mantenere un indice diventato errato
   dopo il riordino delle tracce. Ora segue l'identità della traccia; richieste
   obsolete non modificano il nuovo motore o la nuova sorgente.
4. Metadata di una traccia container diversa potevano sovrascrivere lingua e
   codec nativi. Il merge ora richiede un abbinamento coerente. Una traccia
   conosciuta solo dai metadata non viene presentata come selezionabile su
   VIDAA quando manca la relativa API nativa; resta distinta da un codec
   esplicitamente non supportato. L'audio automatico resta disponibile.
5. Il rifiuto di `video.play()` veniva assimilato da una Promise prima che il
   gestore del fallback potesse intercettarlo. Il fallback HLS esistente ora
   riceve il rifiuto esplicito di formato, carica la libreria solo se necessaria
   e scarta completamenti obsoleti. Non viene attivato semplicemente perché
   un video in riproduzione è silenzioso.

Le guardie VIDAA non cambiano il percorso dei sottotitoli. Nessun timer
aggiuntivo o nuovo fallback indiscriminato cerca di nascondere il problema.
Mute e volume sono stati osservati nelle prove; la gestione condivisa che
inizializza il video e controlla il gate non è stata sostituita.

### Prove con l'account e sulla TV reale

Usati profilo 1, preferenza audio italiana e gli addon AIOStreams ed EasyStream
dell'account autorizzato. Contenuto: **Teach You a Lesson**, S01E10, prime
sorgenti FHD. Credenziali, configurazioni private e URL sono rimasti in memoria;
non sono stati copiati in questo rapporto, nei log o nel pacchetto.

La TV Hisense associata ha eseguito il player del fork e quello corretto in una
pagina diagnostica temporanea HTTP sulla LAN, distinta dall'origine HTTPS di
produzione. Installazione e dati di produzione non sono stati cambiati. Le prove
non scrivevano progressi nell'account e non attivavano scrobbling.

| Verifica                                                       | Esito e limite                                                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intestazioni delle due FHD                                     | MKV, HEVC Main 10; tre audio AAC LC 48 kHz 5.1: italiano predefinito, coreano, inglese                                                                      |
| Prima apertura del fork precedente                             | L'utente ha confermato audio italiano udibile sulla TV                                                                                                      |
| Tracce native reali                                            | La TV espone `ita`, `kor`, `eng`; italiano attivo e altre tracce disattivate                                                                                |
| Riaperture e cambio AIOStreams/EasyStream, versione precedente | Raccolti stati reali di caricamento e riproduzione; nei finali AIO/Easy osservati il gate era rilasciato, mute falso, volume 1, italiano attivo             |
| Versione corretta sulla TV                                     | AIO riproduceva con readyState 4, mute falso, volume 1 e italiano attivo; comandi manuali coreano e poi italiano confermati dai rispettivi flag nativi      |
| Versione corretta, passaggio a EasyStream                      | Riproduzione avanzata oltre 4 secondi, readyState 4, mute falso e italiano attivo; successivamente l'utente è uscito dalla pagina e la raccolta è terminata |
| Ulteriore sorgente HLS dello stesso episodio                   | L'addon la elenca, ma la risorsa restituisce HTTP 404; non è una prova di incompatibilità audio o codec                                                     |

I contatori `webkitAudioDecodedByteCount` e `webkitVideoDecodedByteCount`
restituiscono entrambi zero anche durante la riproduzione: su questa TV non
sono stati usati come prova di audio decodificato o di silenzio.

**Il silenzio intermittente originale non è stato riprodotto sulla TV in questa
sessione.** Sono stati riprodotti e corretti i difetti di selezione con test
deterministici; l'ascolto italiano reale alla prima apertura esclude un veto
generale alla combinazione MKV/HEVC/AAC 5.1 osservata. Non certifica ogni file,
variante AAC o uscita audio della TV. L'audio udibile della versione corretta
non ha ricevuto una conferma separata dell'utente dopo tutti i cambi.

### Controlli e pacchetto

- `npm run test:vidaa`: **81 suite PASS**.
- Nuove suite: identità tracce (9 casi), selezione rifiutata/rollback,
  rifiuto play/fallback HLS. Esperimenti tracce: **26 PASS**.
- Coperti cambi sorgente, motore e traccia, richieste obsolete, ripresa,
  sottotitoli, errori del player e regressioni del telecomando.
- `node tests/run-vidaa-home-dom-tests.mjs`: **10 fixture Chrome PASS**.
- `npm run lint` e `git diff --check`: **PASS**.
- `npm run package:vidaa`: **PASS**.

Archivio audio separato: `dist/nuvio-vidaa-audio.zip`.
SHA-256: `e5e20c6697a83fa528ef0edacd2b1b1056b5c6d9275ca38ab067aeb5ae78e0a2`.

Restano necessarie prove di ascolto prolungate sul runtime installato HTTPS,
più aperture della sorgente problematica quando si presenta il difetto,
sospensione/riavvio della TV e sorgenti HLS/DASH realmente disponibili.
I test simulati di questi percorsi non equivalgono a tali prove sul dispositivo.

<a id="fluidity"></a>

## Caricamento e scorrimento VIDAA

Verifica del 16 ottobre 2026. Prima delle modifiche alla fluidità sono stati
committati e pubblicati account, Trakt, audio e caratteri nel commit `93fa57bd`.
Quel commit costituisce il riferimento delle prove grafiche sul dispositivo.

### Cause individuate e correzioni

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

### Espansione landscape

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

### Avvio iniziale

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

### Immagini reali

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

### Prove e limiti

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

### Build pubblica e Trakt

La verifica del primo push ha rilevato una configurazione Trakt incompleta sul
sito pubblico, benché il pacchetto locale fosse configurato. Vercel prepara ora
la configurazione applicativa dalla release ufficiale con checksum fissato
prima del packaging. Una coppia esistente completa viene conservata; una coppia
parziale incompatibile provoca errore senza sovrascrittura. Nessun valore viene
committato o stampato. Rimane necessaria l'approvazione del codice dispositivo
da parte dell'utente per collegare il proprio account Trakt.

<a id="sources"></a>

## Sorgenti VIDAA: caratteri e lingua

Verifica del 16 ottobre 2026 sul fork locale, confrontato con
NuvioMedia/NuvioTVSmart `cee232e571fa01a3175b2798e5c7bc513f476f65`.
Le modifiche precedenti a sincronizzazione, Trakt e audio sono conservate.

### Risposta originale e visualizzazione

Usati il profilo 1 dell'account autorizzato, gli addon installati e
**Teach You a Lesson S01E10**, già indicato per la prova audio.
Le risposte originali sono state lette direttamente dagli endpoint degli
addon; credenziali e URL configurati o dei video sono rimasti in memoria.
Sono stati conservati solo esempi testuali sanitizzati per le regressioni.

La risposta AIOStreams usa lettere fonetiche piccole, apici e pedici che non
appartengono all'alfabeto matematico già gestito dal fork. Esempi reali:

| Originale                            | Visualizzazione corretta                          |
| ------------------------------------ | ------------------------------------------------- |
| `✓ ɪᴛ · ᴇɴ · sᴜʙ (ɪᴛᶠᵒʳᶜᵉᵈ)`         | `✓ it · en · sub (itforced)`                      |
| `Teach You A Lesson s₀₁·ᴇ₁₀`         | `Teach You A Lesson s01·e10`                      |
| `1.43 ᴹᵇᵖˢ`                          | `1.43 Mbps`                                       |
| Bandiere EasyStream, ad esempio `🇮🇹` | Indicatore leggibile `[IT]`, già gestito dal fork |

La normalizzazione è circoscritta alle lettere decorative e ai numeri.
Accenti, altre scritture e simboli significativi vengono conservati, compresi
gli ZWJ delle emoji composte. I separatori invisibili di padding dell'addon
non vengono eliminati indiscriminatamente. Aggiungere soltanto il font Roboto
già incluso non coprirebbe tutti gli alfabeti decorativi osservati.

Il nome sorgente nel player in pausa ora usa la stessa normalizzazione
VIDAA; anche il nome dell'addon usato come titolo di ripiego è normalizzato.
Le schede e i pannelli continuano a ricevere i metadata originali. URL,
hash, identificatori, intestazioni e nomi file utilizzati per aprire la
sorgente non vengono riscritti. La ricerca usa una rappresentazione separata.

### Lingua audio, sottotitoli e ordine

Il folding rende leggibili e ricercabili anche `ɪᴛ` e `ᴇɴ`. Per inferire la
lingua audio, le liste esplicitamente marcate `SUB`, `Subtitles` o
`Sottotitoli` vengono escluse. I codici piccoli sulla riga audio, ad esempio
`✓ ɪᴛ`, sono riconosciuti. I metadata strutturati conservano la precedenza.
Ogni campo è esaminato separatamente: una descrizione `Subtitles: Italian`
non può consumare il nome file successivo che dichiara `ITA-KOR-ENG`.
Il titolo del film `It` non diventa per questo un indicatore italiano.

| Risposta del campione                                     | Esito dopo la correzione                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| AIOStreams, 76 sorgenti                                   | Audio italiano riconosciuto nelle posizioni 1 e 2                                                                            |
| AIOStreams, 18 sorgenti con italiano solo nella lista SUB | Nessuna classificata erroneamente con audio italiano; l'assenza di metadata audio resta distinta da audio inglese dichiarato |
| EasyStream, 3 sorgenti                                    | Tutte riconosciute con audio italiano                                                                                        |
| Prima FHD AIOStreams                                      | Nome file `ITA-KOR-ENG.MULTI`; audio italiano confermato nella precedente prova reale                                        |
| Prima FHD EasyStream                                      | Nome file `ITA-KOR-ENG.MULTI`; la TV espone la traccia italiana                                                              |

Sul profilo provato la preferenza audio è italiana; l'avvio è impostato su
`FIRST_STREAM`, con tutte le sorgenti e riuso dell'ultimo collegamento e del
gruppo episodi abilitati. Non è configurato un ordinamento Debrid esplicito.
La preferenza della traccia audio non impone un riordino degli addon.
L'espressione regolare salvata non è attiva nella modalità `FIRST_STREAM`.

Il mapping e l'ordinamento degli addon coincidono con upstream. La selezione
`FIRST_STREAM` sul campione AIOStreams ed EasyStream sceglie la posizione 1,
già italiana. La selezione per qualità del player coincide anch'essa con
upstream ed è successiva alle scelte esplicite della schermata sorgenti.
Le priorità per ultimo collegamento e gruppo episodi non sono state cambiate.
È stato verificato anche il terzo addon installato che dichiara risorse stream,
Easy Catalogs: risposta HTTP 200, zero sorgenti per lo stesso episodio. Non ci
sono nomi addon duplicati. Sulle 79 sorgenti complessive, l'ordinamento di
produzione e `FIRST_STREAM` selezionano la prima AIOStreams, già italiana.

**La prima sorgente non italiana segnalata non è stata riprodotta sul campione
disponibile.** Non viene introdotto un ordinamento italiano globale senza
una regola configurata. Per verificarla ulteriormente serve un titolo/episodio
in cui la differenza si ripresenti e il confronto con la stessa risposta addon.

### Verifiche sul dispositivo e automatiche

La TV Hisense associata ha caricato una pagina temporanea LAN con le due
prime sorgenti reali, metadata sanitizzati, componenti delle schede e CSS
del progetto. Il confronto affiancava la normalizzazione precedente e quella
corretta. La TV ha confermato caricamento di due schede, lettere piccole
normalizzate e episodio leggibile; **l'utente ha confermato visivamente
«Lettere leggibili» nella colonna corretta**.
Non sono stati installati aggiornamenti sulla TV né trasferiti token Nuvio.
Questa prova verifica le lettere dei campioni, non tutti i simboli di ogni addon.

I test coprono Unicode, lingua audio distinta dai sottotitoli, preservazione
dei dati originali, filtri, ordinamento, riuso, caricamento automatico e pannelli
del player. Esiti completi sulla versione finale:

- `npm run test:vidaa`: **81 suite PASS**.
- `node tests/run-vidaa-home-dom-tests.mjs`: **10 fixture Chrome PASS**.
- `npm run lint` e `git diff --check`: **PASS**.
- Revisione indipendente delle modifiche Unicode/lingua: nessun blocco rilevato.

I controlli automatici simulano il backend e i percorsi media indicati nei test;
la conferma visiva sulla TV e le letture reali degli addon sono prove distinte.

### Pacchetto finale

Archivio: `dist/nuvio-vidaa.zip`, **7.745.987 byte**, 173 file.
Build VIDAA: `915f32adee15d0ad`.
SHA-256: `ea3e3cb327998851ee074ea32577cc92fe236aa2a1cba14e5cd957f9548f593b`.
`npm run package:vidaa`: **PASS**.

Il pacchetto comprende anche le correzioni account/Trakt e audio documentate
separatamente. La configurazione applicativa ufficiale Trakt è presente.
L'archivio è stato verificato in memoria: assenti email e token dell'account,
URL privati degli addon e dei video usati, file diagnostici, test e
`local.properties`. Le credenziali non sono state scritte nelle sorgenti.

Conservato anche `dist/nuvio-vidaa-audio.zip`, pacchetto intermedio che precede
le correzioni Unicode/lingue, con hash nel rapporto audio.

Restano da provare nell'app installata: aperture ripetute con ascolto della
versione corretta, riavvio/sospensione, confronto dei progressi con un secondo
dispositivo e approvazione interattiva Trakt dalla TV. La verifica visiva delle
lettere su questa TV è invece completata.
