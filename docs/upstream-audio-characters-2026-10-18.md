# Verifica upstream, audio e caratteri — 18 ottobre 2026

Checkout esaminato: `997b0b9c` del fork `Empi9245/nuviotvsmart`, versione
applicativa 1.2.5. Le modifiche già presenti a README, `.gitignore` e alla
riorganizzazione dei rapporti VIDAA sono state conservate.

## Confronto con GitHub

GitHub identifica `derpwinnie/NuvioTVSmart` come parent del fork e
`NuvioMedia/NuvioTVSmart` come repository sorgente originale.

- Parent: `10a23a00604fca2e2b72ec8e095a9de8d72ba7cd`, 15 ottobre.
- Originale ufficiale: `ecaa047f5ec6988e6171b20324dde097d528c059`, 18 ottobre.
- Ultima release: [1.2.7](https://github.com/NuvioMedia/NuvioTVSmart/releases/tag/1.2.7).
- Il fork contiene già integrazioni selettive della 1.2.5 (`cee232e5`): la
  divergenza della cronologia Git non equivale al numero di correzioni mancanti.

Le versioni 1.2.6 e 1.2.7 aggiungono Watch Party, modalità Ambient, shuffle
episodi, integrazioni MDBList e media server, miglioramenti Trakt/Simkl,
sottotitoli, riuso link e correzioni seek/ripresa Tizen e webOS. Fra 1.2.5 e
1.2.7 cambiano 344 file. Non è stato eseguito un aggiornamento generale della
base: questa verifica corregge i problemi circoscritti audio/caratteri.

Il confronto delle funzioni di selezione audio, fallback iniziale e relative
policy non mostra una nuova correzione ufficiale del silenzio VIDAA. Le nuove
funzioni native AVPlay e Luna riguardano Samsung e LG e non forniscono
automaticamente un decoder o un servizio audio a Hisense.

## Audio: difetto individuato e corretto

`supportsTvWebAudioAmplification()` escludeva Tizen e webOS, ma lasciava
attivo il potenziamento Web Audio su VIDAA. Con un valore maggiore di zero,
anche salvato in precedenza, il mount chiamava `createMediaElementSource(video)`.
Il video principale non richiede le risorse con `crossorigin`: uno stream
esterno può quindi riprodurre il video mentre Web Audio emette silenzio.

È un comportamento previsto dalla
[specifica Web Audio](https://www.w3.org/TR/webaudio-1.0/#MediaElementAudioSourceOptions-security).
Riportare il guadagno a 1 non rimuove il collegamento del media element al
grafo Web Audio. Anche la disponibilità di `AudioContext` non prova che il
firmware gestisca quel percorso audio.

VIDAA ora segue la stessa esclusione delle altre piattaforme TV. Il player
conserva l'uscita audio nativa anche se esiste un valore di boost salvato.
Preferenze salvate e volume nativo non vengono riscritti; il potenziamento
resta disponibile nel browser come prima.

Il nuovo test delle funzioni reali del player falliva prima della correzione
e passa dopo. Copre boost 0/6/20 dB, valore persistente, cambio sorgente,
assenza di creazione del grafo sulle tre TV e funzionamento del browser.

Questo difetto è una causa concreta di silenzio quando il boost è attivo.
Senza il titolo/sorgente originale e l'ascolto sulla TV non è possibile
attribuirgli tutti gli episodi di silenzio segnalati. Le precedenti protezioni
per conferma asincrona, rollback della traccia, identità delle tracce e
rilascio del mute iniziale sono state verificate con le suite esistenti.

### Correzione DASH ripresa dall'originale

È stata integrata la parte di upstream 1.2.7 che inoltra le intestazioni di
riproduzione nel motore `dash.js`, prima di inizializzare il manifest. Include
`adaptiveRequestHeaders.js` identico al commit ufficiale `ecaa047f` e mantiene
la gestione del proxy webOS quando i segmenti puntano a un CDN differente.
Manifest, inizializzazione audio/video e segmenti ricevono ora le intestazioni
consentite, per esempio `Authorization`. Prima questa configurazione mancava
nel fork. Le intestazioni controllate dal browser restano escluse e i dati
specifici della richiesta, come `Range`, vengono conservati.

Il test del controller reale falliva prima dell'integrazione e passa dopo.
I diagnostici indicano anche per `dash.js` i soli nomi delle intestazioni
inoltrate, senza stamparne i valori. Il cambiamento riguarda il motore DASH
JavaScript: non aggiunge intestazioni al video nativo e non modifica la scelta
dei motori o i limiti CORS del browser. È una correzione di trasporto, non una
nuova capacità di decodifica audio del firmware.

## Caratteri: verifica e correzioni aggiuntive

Titoli e descrizioni degli stream erano già normalizzati nel fork: lettere
matematiche decorative, maiuscoletto fonetico, apici/pedici e bandiere.
Esempi verificati: `ɪᴛ → it`, `𝐈𝐓 → IT`, `🇮🇹 → [IT]`,
`s₀₁·ᴇ₁₀ → s01·e10`. I test comprendono anche il nome file in descrizione,
codec, lingua audio distinta dai sottotitoli e campi originali invariati.

Restavano percorsi scoperti, ora corretti:

- Nome addon nella scheda della schermata sorgenti e relativa etichetta logo.
- Nome addon nel filtro della schermata sorgenti.
- Filtri delle sorgenti nel player e nella scelta stream dell'episodio.
- Iniziali del badge addon: `charAt(0)` poteva tagliare un carattere Unicode
  in due, generando un surrogato isolato. Ora la lettura e il limite delle
  iniziali operano su caratteri completi, dopo la normalizzazione prevista.

Il nuovo caso riproduceva prima un'iniziale corrotta a partire da
`𝐀𝐝𝐝𝐨𝐧 ɪᴛ`; ora restituisce `AI` e mostra `Addon it`. Un nome con emoji e
giapponese mantiene caratteri completi. La fixture DOM in Chrome verifica
schede, descrizioni, nomi addon, filtri e identità dei filtri originali.

La conversione è applicata alla visualizzazione. URL, identificatori, hash,
nomi file effettivi e dati originali degli addon restano invariati. Le
lettere decorative non controllano la decodifica audio: la lingua mostrata o
inferita e il codec effettivo sono informazioni distinte. Non sono state
eliminate arbitrariamente emoji o scritture non latine.

La prova Chrome verifica il testo generato, non la copertura dei font di ogni
firmware VIDAA. Se compare ancora un rettangolo per un simbolo differente,
serve conservare un esempio preciso per estendere la conversione mirata.

## Esiti e pacchetto

- `npm run test:vidaa`: **85 suite PASS** sulla versione finale.
- `node tests/run-vidaa-home-dom-tests.mjs`: **10 fixture Chrome PASS**;
  inclusa la fixture Unicode estesa. Non misura i font o l'audio della TV.
- `npm run lint` e lint mirato dei test modificati: **PASS**.
- `git -c core.whitespace=cr-at-eol diff --check`: **PASS**; rispetta i file
  CRLF già presenti nel checkout senza riscrivere le modifiche dell'utente.
- `npm run package:vidaa`: **PASS** sulla versione finale.
- Archivio controllato: worker presente; assenti test, rapporti, `.cache`
  e `local.properties`.

Pacchetto locale: `dist/nuvio-vidaa.zip`, **7.752.776 byte**, 186 voci ZIP.
Build VIDAA: `e03fc187824fa395`.
SHA-256: `8d5cb70f7c40eeefc727cc6a39b577a14171786ad89f29604cbdd4d633932a2e`.
Correzioni salvate localmente; nessun commit, push o deploy eseguito.

Prova successiva sulla TV: riaprire completamente l'app con questa build,
controllare descrizioni, nomi e filtri degli stream e ascoltare più sorgenti.
Se ricompare il silenzio con boost disabilitato, registrare titolo/episodio,
addon, sorgente e traccia audio scelta per una verifica mirata del codec e
del percorso nativo. Nessun test di ascolto è stato eseguito in questa sessione.
