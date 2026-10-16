# Sorgenti VIDAA: caratteri e lingua

Verifica del 16 ottobre 2026 sul fork locale, confrontato con
NuvioMedia/NuvioTVSmart `cee232e571fa01a3175b2798e5c7bc513f476f65`.
Le modifiche precedenti a sincronizzazione, Trakt e audio sono conservate.

## Risposta originale e visualizzazione

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

## Lingua audio, sottotitoli e ordine

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

## Verifiche sul dispositivo e automatiche

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

## Pacchetto finale

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
