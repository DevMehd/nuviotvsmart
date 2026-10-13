# Correzioni Impostazioni Account e manifest VIDAA

Verificate il 13 ottobre 2026 nella build **1.2.5**, a partire dall'integrazione upstream e dalle precedenti correzioni Account/addon.

## Correzioni

La pagina **Impostazioni → Account** aggiornava le statistiche avviando un nuovo caricamento completo delle impostazioni. Questo attendeva anche i manifest degli addon; intanto il modello già mostrato conservava lo stato di caricamento. Ora le statistiche aggiornano subito il modello e la schermata, indipendentemente dagli addon. Anche un aggiornamento del modello avviato prima della risposta usa lo stato Account corrente.

La richiesta delle statistiche ha un limite di 12 secondi, valido anche senza AbortController. In caso di errore la pagina mostra un messaggio e **Riprova**. Cambio di sessione, disconnessione e uscita dalle Impostazioni invalidano le risposte precedenti.

Il comando **Installa** legge il valore corrente del campo URL: una tastiera che aggiorna il testo senza notificare subito `input` non può più far utilizzare una bozza precedente e più corta. Il campo usa testo con `inputmode="url"`, disabilita correzione ortografica e maiuscole automatiche e comunica alla tastiera una capacità di 65.536 caratteri. Gli eventi `paste` con dati disponibili conservano l'intero testo e la selezione; sono gestiti anche gli aggiornamenti tramite solo `change`.

Queste correzioni conservano tutto il testo ricevuto dall'app. Non possono ricostruire i caratteri eventualmente eliminati dall'app mobile o dal firmware prima dell'arrivo sulla pagina.

## Verifiche

- Entrambi i difetti sono stati riprodotti prima della correzione con i moduli reali dell'app.
- **69 suite VIDAA superate**, comprese le nuove verifiche su Impostazioni/Account e URL lunghi.
- Prova in Chrome con DOM reale: statistiche visibili mentre i manifest restano sospesi, errore con Riprova, ripristino dei dati, incolla di oltre 20.000 caratteri e installazione dopo una modifica silenziosa.
- Lettura delle statistiche dal backend reale con l'account di test predisposto: dati caricati, nessun errore, circa 109 ms. Nessun dato di un account utente modificato.
- Controllo del codice superato. Pacchetto VIDAA generato con versione **1.2.5** in `dist/nuvio-vidaa.zip`.

La prova dell'incolla dall'app mobile VIDAA su una TV fisica resta da effettuare.

Riferimenti per gli eventi della tastiera: [clipboardData](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData) e [specifica degli input URL](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/url). La [guida ufficiale VIDAA](https://www.vidaa.com/wp-content/uploads/2020/12/WebApp_Development_Guide_for_VIDAA.pdf) descrive una tastiera nativa il cui comportamento dipende dal modello.
