# Correzioni Account e addon — 13 ottobre 2026

## Diagnosi

La configurazione del codice e del pacchetto VIDAA coincide: modalità `shared`, progetto `oltcrfpuccskppegnqwi.supabase.co`, chiave pubblica. L'integrazione upstream 1.2.5 non aveva modificato questo collegamento. Gli account della build appartengono al nostro progetto Supabase; gli account registrati sull'originale Nuvio non vengono trasferiti automaticamente.

Il backend è raggiungibile dal PC. Sono riusciti autenticazione e rinnovo della sessione del solo account di test già predisposto, lettura di profili, informazioni di sincronizzazione, catalogo avatar e tabella addon. I manifest Cinemeta e OpenSubtitles rispondono HTTP 200 e consentono le richieste da altre origini.

Usando i repository reali dell'app con l'account di test, le statistiche Account vengono caricate e la lista addon viene letta e risalvata senza modificarla. Le statistiche visualizzate in Account leggono i dati locali: non devono aspettare una richiesta Supabase.

## Errori riprodotti e corretti

1. **Attesa circolare con credenziali scadute.** Una richiesta protetta poteva attendere il rinnovo del token, che avviava la disconnessione; la disconnessione attendeva a sua volta la richiesta o il servizio di sincronizzazione. Ora le richieste della sessione vengono annullate prima di attendere la pulizia, compresa l'intera risoluzione del proprietario della sincronizzazione. Funziona anche senza AbortController.
2. **Autenticazione senza scadenza.** Login, rinnovo e alcune chiamate di sincronizzazione potevano restare sospesi. Ora il trasporto auth ha un limite di 20 secondi, comprensivo del corpo della risposta; il rinnovo rientra anche nel limite della richiesta HTTP che lo ha avviato. Le risposte tardive di sessioni annullate vengono scartate. Un guasto temporaneo conserva la sessione; un token invalido richiede un nuovo accesso.
3. **Pausa del backend applicata agli addon.** Il periodo di attesa dopo una risposta 429/503 era condiviso anche con richieste esterne. Ora i limiti Supabase non bloccano manifest e dati degli addon, e un addon limitato non blocca il backend dell'account.
4. **Ripristino della vecchia lista dopo disconnessione.** Se il salvataggio degli addon invalidava la sessione, l'interfaccia poteva ripristinare il precedente elenco nell'account successivo o nella modalità ospite. Ora controlla sessione e profilo dopo il salvataggio prima di effettuare un ripristino.

## Verifica e consegna

- 15 test mirati su scadenze, token invalidi, disconnessione, risposte tardive, limiti indipendenti, contatori Account e ripristino addon.
- Login, rinnovo, caricamento Account e sincronizzazione addon verificati contro il backend reale con l'account di test. Nessun account utente modificato.
- `npm run test:vidaa`: tutte le **67 suite** superate, incluse le 15 verifiche mirate.
- `npm test`: superati i test dei plugin e dell'inoltro webOS. `npm run lint` e `git diff --check`: superati.
- `npm run package:vidaa`: pacchetto corretto `dist/nuvio-vidaa.zip`, versione **1.2.5**, **7.40 MiB**. Verificate integrità ZIP e presenza delle correzioni nel codice incluso.
- Server, chiave pubblica e schema Supabase non sono stati cambiati.

Non è stata effettuata una prova su TV per questa correzione. Senza i link degli addon segnalati non si può verificare il loro servizio, la compatibilità dei contenuti o il comportamento TLS/CORS del dispositivo. Le correzioni risolvono i blocchi riprodotti; non attestano il funzionamento di ogni addon Stremio.

Riferimenti consultati: [API key Supabase](https://supabase.com/docs/guides/getting-started/api-keys) e [strumenti di osservazione e diagnosi](https://supabase.com/docs/guides/observability).
