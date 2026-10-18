# Integrazione NuvioTVSmart 1.2.7 — 18 ottobre 2026

Riferimento ufficiale: `NuvioMedia/NuvioTVSmart`, commit
`ecaa047f5ec6988e6171b20324dde097d528c059`, release 1.2.7.
Checkpoint del fork prima dell'integrazione: `385fe13a`, comprensivo delle
correzioni audio, DASH e caratteri e del consolidamento dei rapporti VIDAA.

## Aggiornamenti integrati

- Watch Party: inviti QR, anteprima, sincronizzazione, controlli host,
  recupero della posizione, condivisione sorgente e cambio episodio.
- Ambient: slideshow durante l'inattività, escluso durante i trailer.
- Riproduzione casuale degli episodi con cronologia persistente.
- Collegamento account MDBList e liste della libreria.
- Poster personalizzati configurabili dal telefono e sincronizzati per profilo.
- Importazione e sincronizzazione dei contenuti visti dai media server.
- Posizionamento ASS, spazio per i sottotitoli sopra i controlli, informazioni
  stream, riconoscimento episodio dal nome file e riuso dei collegamenti.
- Aggiornamenti Trakt/Simkl: attività, mantenimento dei progressi dopo errori,
  ripristino delle sorgenti al nuovo accesso e messaggi di errore.
- Correzioni Tizen per seek/ripresa, redirect e indicatore di caricamento;
  seek esatto del player webOS per Watch Party.
- Completamento episodio conservato durante la sessione, limite di Skip Intro,
  layout del pannello Party e traduzioni ufficiali.

La versione applicativa e il lockfile sono aggiornati a 1.2.7. La cronologia
dell'originale viene integrata con un merge, senza riscrivere quella del fork.

## Adattamenti mantenuti

Il player VIDAA conserva uscita audio nativa, conferma asincrona della selezione,
rollback dopo un cambio rifiutato e identità delle tracce. Restano la conversione
delle lettere decorative, i filtri leggibili e i dati originali degli stream.

Sono mantenuti il fallback automatico fra sorgenti, il ripristino della posizione,
i controlli sulle richieste obsolete, il caricamento immagini limitato e il ciclo
di vita dei poster. La risoluzione delle nuove sorgenti media server usa anche
l'identità del tentativo: una risposta ritardata non sostituisce una nuova scelta.

Gli stili dei dettagli del fork sono in `css/vidaa-detail.css`, evitando una
collisione con il nuovo `components-61.css` ufficiale. La build include entrambi.
La regolazione degli effetti resta disponibile su VIDAA. La configurazione TMDB
personale e l'opzione locale delle date mantengono il loro comportamento.
La pagina originale `addonsRemote=1` è nuovamente raggiungibile quando richiesta
esplicitamente; l'accesso e la gestione addon ordinari della TV conservano il
flusso ufficiale dell'account. I poster personalizzati funzionano anche su VIDAA;
il QR che richiede il servizio nativo resta disponibile su Tizen e webOS,
come previsto dall'originale.

Il nuovo modulo condiviso Trakt conserva il controllo del profilo introdotto
dall'originale e integra la precedente protezione del fork: prima richiesta dopo
l'intervallo dichiarato, nessun doppio polling durante il rendering, cancellazione
dei completamenti obsoleti dopo stop o cambio schermata/profilo.

Durante il merge sono stati corretti due problemi riprodotti dai test:

1. Un controllo di buffering duplicato impediva a VIDAA di registrare una pausa
   dell'utente e annullare la deadline del fallback.
2. Il parser condiviso MDBList convertiva un valore booleano falso in voto zero.
   Ora accetta solo numeri o stringhe numeriche e normalizza i nomi dei provider.

I test simulati sono stati aggiornati con le nuove dipendenze dell'originale
(media server, router, eventi Ambient, intercettori DASH e configurazione Trakt),
conservando le verifiche del comportamento.

## Configurazione delle integrazioni

Trakt conserva l'importatore fissato alla release 1.2.5, senza cambiare la
configurazione già presente. Il nuovo importatore MDBList legge esclusivamente
il Client ID applicativo dalla release ufficiale 1.2.7:

```sh
node scripts/import-official-trakt-config.mjs --if-missing
node scripts/import-official-mdblist-config.mjs --if-missing
npm run package:vidaa
```

Il download MDBList è verificato con SHA-256:
`2a9b83ba5d85b3c85e78171754539b02279db7ecb774c48dce05a8c068e7ab79`.
Il codice dell'archivio non viene eseguito. I valori configurati, compresi quelli
di un'app personalizzata, restano autorevoli; il percorso `NUVIO_LOCAL_PROPERTIES`
è rispettato. Vercel esegue entrambi gli importatori prima della build.

La configurazione pubblica MDBList è stata preparata localmente dall'archivio
verificato. I valori non sono stampati nei log; non sono importati account,
password o token utente. Il collegamento dell'account richiede l'approvazione
del normale codice dispositivo. Nessuno schema o dato del backend è modificato
dall'integrazione del client.

## Verifica

I risultati finali e l'identità del pacchetto sono registrati al termine dei
controlli della versione integrata. Le prove del browser e dei backend simulati
non sostituiscono l'ascolto e le verifiche delle nuove funzioni sulla TV Hisense.

- Suite VIDAA: **86 PASS**, incluso il nuovo importatore MDBList.
- Suite ufficiali `test:android-parity`: **15 PASS**.
- `npm test`: **PASS**, build e trasporti/plugin.
- Fixture DOM reali in Chrome: **10 PASS**.
- `npm run lint`, lint degli importatori/test ufficiali adattati e controllo
  del diff: **PASS**.
- `npm run package:vidaa`: **PASS**.

La suite Trakt contiene ora 29 casi: anche la nuova lettura `last_activities`
conserva l'identità del profilo attraverso l'attesa del token. Il caso con cambio
profilo verifica che non parta alcuna richiesta con il token precedente.

Pacchetto: `dist/nuvio-vidaa.zip`, **8.094.532 byte**, 187 voci ZIP.
Build VIDAA: `e117c2b4f473d018`.
SHA-256: `582e931975ea86239e4b7a5100785faa0e87b8177e6c9fd8b1d6488e4c07acfe`.
Verificati il worker e la configurazione MDBList; assenti test, rapporti,
`.cache` e `local.properties` dall'archivio.
