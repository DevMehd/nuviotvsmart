# Audio Conan e simboli degli stream — 18 ottobre 2026

Verifica con l'account autorizzato, Detective Conan S1 E4. Sorgenti: prima
AIOStreams e Anime World `[ITA]` nel secondo addon Streamvix, distinta dalla
sorgente Anime Saturn `[SUB]`. Password, sessione account e URL privati sono
rimasti in memoria nel processo diagnostico; non sono inclusi nel rapporto,
nei test o nel pacchetto.

## Problemi riprodotti

**Mute iniziale mantenuto dopo l'avvio.** Il watchdog e il recupero della
sorgente potevano nascondere il caricamento prima del completamento della
presentazione. Il controllo successivo terminava perché il caricamento era
già nascosto, lasciando attivo `startupPresentationAudioMuted`.

Sulla TV reale, AIOStreams con il player precedente ha riprodotto video fino
a 12,42 secondi con `readyState=4`, gate della lingua rilasciato e italiano
selezionato (traccia 10). Entrambi i flag `muted` e `defaultMuted` restavano
veri perché il mute di presentazione era ancora attivo. Non era un limite
generale del codec Dolby Digital Plus.

Il completamento ora prosegue anche con caricamento nascosto se deve ancora
rilasciare quel mute. Le verifiche di lingua, ripresa, errore e cancellazione
restano operative. Il test usa i metodi reali del watchdog, del recupero e del
controller: falliva prima della modifica e passa dopo.

**Streamvix già servito dal proxy rifiutato.** Anime World italiano restituisce
un MP4 H.264/AAC stereo con `notWebReady` e intestazioni dichiarate, ma il suo
URL MediaFlow incorpora già tutte quelle intestazioni nei parametri `h_`.
Il player lo rifiutava prima di avviare il motore, mentre la riproduzione
nativa sulla stessa TV funzionava.

Ora viene ammesso questo caso verificabile: endpoint `/proxy/stream`, proxy e
destinazione HTTP(S), valori incorporati corrispondenti a tutte le intestazioni
limitate dal browser. Duplicati, valori discordanti, intestazioni mancanti,
altri endpoint e `no_proxy` mantengono il comportamento precedente. Il formato
segue la [documentazione MediaFlow](https://github.com/mhdzumair/mediaflow-proxy/blob/main/docs/usage/url-params-and-encoding.md).
La diagnostica espone i nomi delle intestazioni e omette query e credenziali URL.

**Prima traccia mantenuta se i metadata arrivano tardi.** Nel caricamento
più lento AIOStreams esponeva le 18 tracce dopo 13,8 secondi, oltre il timeout
di discovery: il fallback senza tracce reali poteva impedire la scelta
dell'italiano. La prima lista nativa ora consente un solo tentativo della
preferenza prima della presentazione del video. Scelte manuali, altre sorgenti
e riproduzione già presentata non vengono sovrascritte. Dopo la correzione la
stessa TV seleziona automaticamente la traccia italiana 10, con mute spento.

## Riscontro sulla TV

| Prova                                              | Risultato                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Streamvix Anime World italiano, video nativo       | Audio italiano confermato dall'utente                                             |
| AIOStreams, player precedente                      | Video in avanzamento con mute di presentazione ancora attivo                      |
| AIOStreams, player corretto e italiano selezionato | Audio italiano confermato dall'utente; mute disattivato e traccia italiana attiva |
| Streamvix Anime World italiano, player corretto    | Audio italiano confermato dall'utente; mute disattivato e traccia italiana attiva |

Le prove sono eseguite in una pagina diagnostica temporanea sulla LAN, con il
player reale e gli stream originali. Non modificano l'account o l'installazione
di produzione e non scrivono progressi nell'account. I contatori audio/video
WebKit restituiscono zero su questo firmware e non vengono usati come misura
di decodifica. I risultati riguardano le due sorgenti provate, non ogni codec
o stream disponibile negli addon.

## Caratteri

I formati effettivi di AIOStreams e Streamvix contenevano simboli non coperti
dalla precedente normalizzazione. Le etichette visive ora usano parole e
caratteri comuni, per esempio `Video AVC Audio DD+ Channels 2.0`, `Size 270 MB`,
`netflix 1650` e `****-`. Vengono rimossi i separatori invisibili decorativi;
restano preservati alfabeti reali e sequenze intenzionali di emoji. URL,
identificatori, payload e regole di selezione della lingua non vengono
riscritti. La fixture Chrome verifica il testo prodotto; non certifica la
copertura di ogni font del firmware.

## Verifiche e pacchetto

- Regressioni del mute iniziale, dei link MediaFlow e della discovery audio
  tardiva: riprodotte prima delle modifiche, superate dopo.
- Suite header native/HLS/DASH, integrazione e isolamento delle sorgenti,
  rollback delle tracce e lingua degli stream: superate.
- Fixture Unicode nel browser Chrome: superata.
- `npm run test:vidaa`: tutte le **88 suite** superate. Eseguito dopo aver
  creato il pacchetto, richiesto dalla verifica piattaforma; nessuna build
  concorrente durante la verifica finale.
- `npm test` e `npm run lint`: superati. Il test locale del servizio plugin
  richiede accesso alla rete loopback fuori dall'ambiente isolato.
- Controllo del pacchetto: worker presente; assenti test, rapporti, cache,
  credenziali account e `local.properties`.

Archivio `dist/nuvio-vidaa.zip`: 8.097.125 byte, 187 voci.
Build VIDAA: `78c77493466ffe37`.
SHA-256: `edfba593c94727af4edd66454725b3d1066609f9dd0b28c2cce4ae252edf740c`.
