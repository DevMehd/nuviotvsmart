# Account, progressi e Trakt su VIDAA

Verifica del 16 ottobre 2026. Fork: `Empi9245/nuviotvsmart`, base locale
`19fd6c76`. Riferimento ufficiale:
[`NuvioMedia/NuvioTVSmart`](https://github.com/NuvioMedia/NuvioTVSmart), commit
`cee232e571fa01a3175b2798e5c7bc513f476f65`, confermato anche come HEAD remoto.

## Diagnosi e correzioni

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

## Collegamento Trakt

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

## Verifiche reali completate

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

## Verifiche automatiche

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

## Pacchetto e prove ancora necessarie sulla TV

Pacchetto intermedio della sola verifica account: 7740976 byte, 173 file.
Build VIDAA: `0e9bda7e0df28761`.
SHA-256: `0bf9b267cad6289a43f8e54c48f6533a122e400a370da32dde44310507bec804`.
È stato successivamente sostituito dall'archivio completo
`dist/nuvio-vidaa.zip`, che comprende anche audio e sorgenti; dettagli in
[Sorgenti VIDAA: caratteri e lingua](source-language-display-verification.md).

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
