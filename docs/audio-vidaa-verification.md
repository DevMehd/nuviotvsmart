# Audio VIDAA: correzioni e verifiche del 16 ottobre 2026

Confronto con NuvioTVSmart ufficiale `cee232e5` e con il fork prima delle
correzioni audio. Le modifiche account/Trakt precedenti sono conservate.

## Cause riprodotte nel codice

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

## Prove con l'account e sulla TV reale

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

## Controlli e pacchetto

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
