# Account Nuvio ufficiali su VIDAA

Ripristino del 13 ottobre 2026 nel progetto `D:\nuvio\nuviotvsmart`. Il repository iniziale era pulito, al commit `9f5e5c7a`; non sono state sovrascritte modifiche locali dell'utente. Il riferimento per schermate, testi e azioni è [NuvioMedia/NuvioTVSmart 1.2.5](https://github.com/NuvioMedia/NuvioTVSmart/tree/cee232e571fa01a3175b2798e5c7bc513f476f65).

## Confronto del codice

Sono stati letti i file effettivi di autenticazione, configurazione, sessione e sincronizzazione, fissando i confronti ai seguenti commit. L'esame del sorgente dimostra i protocolli implementati; non equivale a una prova di accesso con un account reale in ciascun fork.

| Progetto                                                                                                                              | Commit     | Riscontro                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart/tree/cee232e571fa01a3175b2798e5c7bc513f476f65)                   | `cee232e5` | Originale. QR dispositivo, sessione anonima temporanea, avvio/poll/exchange, rinnovo GoTrue, sincronizzazione per profilo. La configurazione pubblica d'esempio contiene `https://api.nuvio.tv` e la chiave anon.                                                                                                                                             |
| [derpwinnie/NuvioTVSmart](https://github.com/derpwinnie/NuvioTVSmart/tree/adce83fbead2c779528e2aeed1154079f9d49671)                   | `adce83fb` | `authManager.js`, `qrLoginService.js` e `collectionSyncService.js` identici all'originale nel contenuto. Stessi URL ufficiali e chiave pubblica nel client d'esempio.                                                                                                                                                                                         |
| [iqui27/NuvioTVSmart-legacy-webos](https://github.com/iqui27/NuvioTVSmart-legacy-webos/tree/d9582f98e7865eccd0b3c11fed7974d33233d51e) | `d9582f98` | Gestione auth e QR identica; stessa sincronizzazione collezioni mediante RPC per profilo, con differenze di lifecycle rispetto alla versione più recente. Ultimo aggiornamento del fork: 25 settembre 2026.                                                                                                                                                   |
| [ysosrs123/NuvioTV-Fork](https://github.com/ysosrs123/NuvioTV-Fork/tree/5f98b38809535b4201e106d3ac8c36378d946e0f)                     | `5f98b388` | Fork Android TV: stesse RPC di avvio, poll, exchange e sincronizzazione. Configurazione tramite BuildConfig/properties, scelta ufficiale predefinita, URL telefono `nuvio.tv/link` e fallback `tv-login`. Rinnovo e diagnostica sono implementati nel client nativo. Le credenziali della build distribuita non sono deducibili dai placeholder del sorgente. |
| [bobsupra/NuvioTVOS](https://github.com/bobsupra/NuvioTVOS/tree/45faa31ce8a58de9bd9b5b0e98af96021391113f)                             | `45faa31c` | Progetto collegato tvOS: backend `api.nuvio.tv`, chiave publishable pubblica, QR legacy con nonce/poll/exchange, sessione persistente e rinnovo. Verifica dell'identità backend e generazioni per scartare operazioni obsolete.                                                                                                                               |
| [techuhak/Nuvio-Account-Manager](https://github.com/techuhak/Nuvio-Account-Manager/tree/c122c44f86f3f9aa58ae742ae4abcc2f0ebba971)     | `c122c44f` | Progetto collegato: login password contro `api.nuvio.tv` con la stessa chiave anon pubblica; lettura/scrittura di addon e collezioni per `profile_id`. Conferma il formato `collections_json`. Non è il riferimento UI e non è stato integrato.                                                                                                               |
| [NuvioMedia/NuvioTV](https://github.com/NuvioMedia/NuvioTV/tree/b9dae5c5745fabc1eaddee0ac9b336f1d0b492c8)                             | `b9dae5c5` | Controllo aggiuntivo del client Android ufficiale: medesimo contratto device login, refresh e addon/collezioni per profilo; configurazione del backend tramite BuildConfig.                                                                                                                                                                                   |

`NuvioMedia/NuvioWeb` risolve allo stesso repository originale NuvioTVSmart, quindi non costituisce un confronto indipendente. I file di ricerca sono esclusi dal pacchetto in `.cache/nuvio-account-research`.

Sono stati esaminati anche gli script pubblicamente serviti da [nuvio.tv/link](https://nuvio.tv/link) e [nuvio.tv/tv-login](https://nuvio.tv/tv-login). La pagina telefono recupera la sessione tramite `get_device_login_session`, effettua l'approvazione con `approve_device_login_session` usando il codice utente e la sessione dell'account già autenticato. Il flusso legacy usa `approve_tv_login_session`. Nessuna di queste operazioni di approvazione viene eseguita dalla TV al posto dell'utente.

## Parti riprese dall'originale

- Menu Addons centrato, gestione dal telefono, ordine cataloghi Home, Refresh e overlay QR; rimossa la deviazione alla schermata shared.
- Schermata Account QR, azioni, testi, istruzioni manuali, condizioni d'uso, conferma logout e statistiche con i componenti originali.
- Configurazione ufficiale predefinita anche su VIDAA. URL e chiave anon provengono dall'originale; la chiave client TMDB e l'identificatore pubblico Trakt sono stati verificati nel [pacchetto originale Tizen 1.2.5](https://github.com/NuvioMedia/NuvioTVSmart/releases/tag/1.2.5). La chiave TMDB coincide con quella servita dal sito ufficiale ed è stata verificata su un catalogo pubblico: HTTP 200, 20 risultati. Nessuna chiave service-role, Supabase secret o OAuth client secret è stata aggiunta.
- Gestione originale di avvio QR, nonce, sessione anonima temporanea, poll, exchange e fallback legacy. Il servizio QR era già identico all'upstream e resta il riferimento.
- Schermata originale delle connessioni, avatar e componenti membership; eliminati i rami locali/shared aggiunti dal port. L'opzione upstream di collegamento a un server scelto dall'utente resta disponibile come nell'originale.
- Recupero e rinnovo della sessione originale, con le correzioni già presenti per deadline, cancellazione e teardown sui browser TV.

I due QR restano distinti:

| Schermata | Destinazione e funzione                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account   | URL univoca restituita dal backend per `https://nuvio.tv/link`; autorizza questo dispositivo. Il fallback originale usa `https://nuvio.tv/tv-login`. |
| Addons    | `https://nuvio.tv/account?tab=addons`; apre sul telefono la gestione dell'account Nuvio. Non autorizza la TV.                                        |

Refresh aggiorna ora anche collezioni, ordine cataloghi e impostazioni del profilo selezionato, utilizzando i servizi originali. Il ciclo foreground/periodico recupera collezioni e ordine Home e segnala le modifiche alla Home. La sincronizzazione non è istantanea: il controllo foreground conserva l'intervallo minimo originale di due minuti e quello periodico di quindici minuti. Dopo una modifica dal telefono, Refresh nella schermata Addons è il percorso immediato.

La Home continua a usare `CollectionsStore` per profilo e i componenti originali delle collezioni e delle cartelle. I pull delle collezioni non generano push di ritorno; gli errori di rete mantengono lo snapshot locale.

## Isolamento e conservazione dei dati

I getter della sessione bloccano le credenziali il cui backend registrato o issuer non corrisponde al backend attivo, anche prima del bootstrap. Le vecchie credenziali senza provenienza leggibile restano bloccate.

Prima di attivare il backend ufficiale, il client salva i dati locali precedenti in una chiave privata del proprio localStorage con prefisso `nuvioAccountArchiveV1:`. La copia comprende profili, addon, collezioni, preferenze, libreria e progressi; esclude access token e refresh token. Solo dopo aver verificato la copia vengono svuotati gli store attivi e i cache derivati. Se lo spazio non consente di salvare la copia, il passaggio si interrompe prima di cancellare i dati. Le impostazioni device dei torrent e l'archivio precedente sopravvivono al logout.

Non sono state eseguite migrazioni o cancellazioni sui backend, né modifiche ad addon, collezioni, libreria o impostazioni dell'account. Le sole operazioni di scrittura della prova live sono quelle normali di autenticazione e approvazione del dispositivo. Gli account e i dati remoti del backend precedente restano intatti. Nessun trasferimento automatico di account o dati dal backend precedente a Nuvio viene effettuato.

## Rimozioni

Rimosse configurazione e variabile di modalità shared, registrazione email personalizzata, schermata Shared Addons, modalità locale aggiunta al port e relativi testi/stili; script di preparazione backend e account di test, test esclusivi del vecchio sistema, SQL/schema/hardening del backend personalizzato e documentazione sostituita da questo rapporto.

Rimossi il prototipo `.cache/collections-qr-prototype`, il suo server/preview e script collegati. Rimosso anche il vecchio pannello alternativo `addonsRemote`, ormai senza collegamenti dal QR ufficiale, e gli strumenti locali di prova del login shared. I record locali con dati di account già presenti sono stati conservati ed esclusi dalla build.

Non esistevano dipendenze npm dedicate al backend personalizzato: quelle rimaste servono ancora a playback, plugin, build e confezionamento. I comandi npm per preparazione/test/live del vecchio backend sono stati eliminati.

Sono conservati adattatore VIDAA, telecomando, focus, input e Indietro, polyfill e trasformazioni per browser TV, riproduzione e installer. Il port evita gli avvisi di aggiornamento dell'installer upstream, che non produce un pacchetto VIDAA. Il pacchetto mantiene asset versionati e cache specifica VIDAA per evitare di caricare il vecchio client.

## Verifiche e pacchetto

- Suite VIDAA automatizzate: 67 suite, inclusa una nuova prova di isolamento backend, conservazione dati, QR start/poll/exchange, restore, rinnovo, revoca, logout, scadenza/riprova, fallback e sincronizzazione addon/collezioni/impostazioni per profilo. Backend simulato.
- Prove DOM in Chrome: le cinque prove Home esistenti e la nuova prova Account/Addons/collezioni. La nuova prova attraversa le schermate reali, genera entrambi i QR, controlla focus/Back, simula approvazione e modifica dal telefono, costruisce le righe Home e apre la cartella fino al catalogo dell'addon.
- Verifica live dal PC: `/auth/v1/signup`, `start_device_login_session` e `poll_tv_login_session` rispondono HTTP 200 con CORS; QR su `nuvio.tv` e stato `pending`. Ripetuta in Chrome con richieste reali tra origini e canvas QR reale.
- Dopo che l'utente ha fornito le credenziali, verifica con l'account reale: login GoTrue, approvazione mediante la RPC ufficiale utilizzata dal telefono, poll `approved`, exchange e corrispondenza del proprietario dell'account. Riusciti anche il recupero delle credenziali conservate nello store della prova, il rinnovo reale e il logout locale. La prova usa uno store in memoria e non dimostra la persistenza dopo il riavvio fisico della TV.
- Lettura reale dei tre profili, con addon, collezioni e impostazioni: tutte le richieste account HTTP 200. I profili secondari ereditano gli addon del principale secondo le impostazioni dell'account. Nessuna credenziale personale o token è stato salvato nel progetto o nel pacchetto.
- Apertura reale di una fonte di una cartella del profilo 2: il componente originale restituisce 50 contenuti. Dopo il controllo automatico sull'accesso a servizi esterni e l'autorizzazione dell'utente, la prova è stata limitata agli host degli addon elencati e ha rifiutato redirect verso altre destinazioni. Gli URL privati e le configurazioni degli addon non sono inclusi in questo rapporto.
- Controlli plugin, lint, build e controllo del diff. Le prove Chrome e plugin usano un profilo/servizio temporaneo isolato.

| Profilo reale | Addon disponibili | Collezioni | Cartelle |
| ------------- | ----------------- | ---------- | -------- |
| 1             | 10                | 5          | 88       |
| 2             | 10                | 6          | 75       |
| 3             | 10                | 6          | 75       |

Pacchetto ricreato: `D:\nuvio\nuviotvsmart\dist\nuvio-vidaa.zip`. Cartella pronta per l'hosting/installazione: `D:\nuvio\nuviotvsmart\dist\vidaa`, ingresso `vidaa.html`. Versione 1.2.5; gli asset e la cache hanno un identificatore di build distinto.

## Prova ancora necessaria sulla TV

La verifica finale richiede una TV VIDAA e l'approvazione dal telefono con un account Nuvio esistente:

1. Installare/servire il nuovo pacchetto alla TV e aprire Account. Scansionare il QR di Account, effettuare l'accesso su nuvio.tv e autorizzare il dispositivo.
2. Controllare il profilo selezionato, addon e collezioni Home. Aprire una cartella e un contenuto.
3. Aprire il QR di Addons, modificare una collezione/addon sul telefono nello stesso profilo, premere Refresh sulla TV e verificare la Home.
4. Riavviare l'app e controllare la sessione persistente. Confermare il rinnovo dopo la scadenza del token, il logout e la riprova di un QR scaduto.
5. Controllare focus, tastiera, Indietro e riproduzione sul firmware VIDAA reale.

Il login e l'approvazione reali sono stati verificati dal PC mediante le API ufficiali. La scansione e l'approvazione nell'interfaccia del telefono, la persistenza dopo il riavvio e la compatibilità di rete/riproduzione del firmware VIDAA restano da provare sul dispositivo.
