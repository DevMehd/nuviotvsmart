# Integrazione NuvioTVSmart 1.2.5

Verifica effettuata il 13 ottobre 2026 sull'[originale NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart).

La versione locale era 1.2.3, al commit `839fa98af64c332427939203acf031ff06726c16`. Sono stati confrontati e integrati i 10 commit upstream successivi all'antenato comune `cfec25654f0580028d9a78a41b037bcd48af2a29`, fino alla [versione 1.2.5, commit cee232e5](https://github.com/NuvioMedia/NuvioTVSmart/commit/cee232e571fa01a3175b2798e5c7bc513f476f65). Il confronto usa la cronologia Git aggiornata, non soltanto il changelog.

## Modifiche integrate

| Area                     | Risultato                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home e MDBList           | Valutazioni configurabili per visibilità e ordine, sincronizzate per profilo; stati certificati Rotten Tomatoes; massimo 3 valutazioni in Modern e 6 in Classic/Grid. Richieste condivise e risposte obsolete scartate. |
| Home e Discover          | Riutilizzo dei poster già decodificati, registrazione dei loghi inseriti durante le transizioni, scelta iniziale del contenuto coordinata con Continua a guardare.                                                      |
| Sorgenti                 | Pulsante di aggiornamento; conservazione del focus durante i risultati progressivi; protezione dalle risposte di richieste superate, anche senza AbortController; meno letture ripetute delle impostazioni dei badge.   |
| Collezioni               | I filtri numerici TMDB vuoti restano non impostati; lo zero esplicito viene conservato.                                                                                                                                 |
| Riproduzione             | Migliore coordinamento di pausa, buffering, avanzamento e fine riproduzione; accessi alla superficie nativa limitati alla piattaforma pertinente.                                                                       |
| Accesso e tastiera webOS | Eliminazione della doppia attivazione OK/click; il passaggio del puntatore non interrompe la modifica di un campo.                                                                                                      |
| Audio webOS              | Importati i moduli upstream per conversione DTS/TrueHD in AC-3, relativi file runtime e licenze. Il percorso è attivo soltanto su webOS; non aggiunge questi codec a VIDAA.                                             |

Versione aggiornata a 1.2.5 in `package.json`, lockfile e `appinfo.json`, senza nuove dipendenze.

## Adattamenti al nostro progetto

Conservati il caricamento e la gestione delle immagini entro i limiti VIDAA, le anteprime localizzate, il recupero delle sorgenti, la selezione delle tracce e i flussi di accesso/backend personalizzati. Conservata anche la nostra implementazione MDBList, che dispone già di richieste limitate, cache e supporto degli identificatori aggiuntivi richiesti dalle nuove funzioni.

Durante l'integrazione è emersa una regressione: la gestione upstream della pausa durante il buffering impediva a VIDAA di cancellare il tempo limite di recupero della sorgente quando l'utente metteva in pausa. È stata aggiunta un'eccezione VIDAA e verificata con il test esistente.

## Verifiche

- `npm run test:vidaa`: **66 suite superate**, comprese 6 nuove verifiche mirate all'integrazione.
- `node tests/run-vidaa-home-dom-tests.mjs`: **5 prove superate** in Chrome, con DOM reale, su immagini, focus, scorrimento, finestre delle righe e aggiornamenti progressivi.
- `npm test`: superati i controlli dei plugin e dell'inoltro delle richieste webOS, inclusa la compatibilità con Node 8.
- `npm run lint`, compilazione, controlli di sintassi dei nuovi moduli webOS e `git diff --check`: superati.
- Pacchetto VIDAA generato: `dist/nuvio-vidaa.zip`, versione **1.2.5**, **7.40 MiB**.

Le verifiche automatizzate non sostituiscono una prova sulla TV: prestazioni reali, tastiera nativa e riproduzione audio/video vanno confermate sul dispositivo. La conversione DTS/TrueHD è stata importata e controllata nella sintassi, senza una prova di decodifica su webOS.

Le successive correzioni di Account e addon e le relative verifiche sono documentate in [account-addon-network-fix.md](account-addon-network-fix.md).
