# Nuvio personnel — Historique des modifications

## 2026-10-29 — 1.3.11

- Nouvel accueil (bêta, moteur DOM) plus fluide sur la télé : les cartes ne créent plus chacune leur propre couche d’affichage, et l’agrandissement au focus n’est plus recalculé à chaque appui sur les télés peu puissantes.
- Les images sont demandées à la taille réellement affichée (fonds et affiches Cinemeta réduits) et la mémoire d’images est plafonnée pour les rangées hors de l’écran ; les rangées visibles chargent toujours leurs images.

## 2026-10-29 — 1.3.10

- Lecteur sur la télé VIDAA : les noms des pistes audio sont aussi lus quand le lien de la source passe par une redirection (cas fréquent des liens debrid ou fournis par un addon). La lecture se fait en arrière-plan et ne retarde pas le démarrage de la vidéo.
- Quand les noms restent indisponibles, le panneau Audio indique pourquoi, par exemple « le serveur refuse la lecture partielle » ou un nombre de pistes différent entre la télé et le fichier. Le Diagnostic guidé enregistre aussi cette raison, sans aucune adresse.

## 2026-10-29 — 1.3.9

- Lecteur sur la télé VIDAA : les pistes audio portent leur vrai nom (langue, format, canaux, ou titre de la piste) au lieu de « Audio 1, Audio 2… ». Cela marche aussi quand la télé affiche ses propres sous-titres et pour les fichiers MP4.
- La lecture démarre sans attendre que ces noms soient lus ; ils apparaissent dès qu’ils sont connus.
- Si le serveur de la source ne permet pas de lire l’en-tête du fichier, « Audio N » reste affiché.

## 2026-10-29 — 1.3.8

- Démarrage plus rapide sur la télé VIDAA : au lancement, l’application ne charge plus que l’accueil et la sélection du profil. Les autres écrans (fiche, lecteur, paramètres, recherche…) sont chargés la première fois que tu les ouvres, puis restent disponibles hors ligne. Si une mise à jour arrive pendant l’utilisation, l’application se recharge une fois d’elle-même au lieu de rester bloquée.
- Le code envoyé à la télé est préparé pour son navigateur (Chromium 111) : moins de code à lire au démarrage. Les autres télés (Samsung, LG) gardent la version actuelle.
- Les puces techniques des liens vidéo (2160p, HDR, codec…) et les packs de badges Xperience (Nard, Elite, choix « Pack de badges » par profil) sont disponibles sur toutes les plateformes (VIDAA, Samsung, LG) ; les puces apparaissent quand aucun badge graphique ne correspond. Sur les autres télés, sans choix de pack, les badges importés restent utilisés. En mode Essentiel, la section Flux ne montre plus que « Pack de badges », y compris sur VIDAA ; les autres réglages des flux restent en mode Avancé. Quelques délais de chargement de l’accueil et des collections suivent désormais le mode de performance plutôt que le seul modèle de télé (en mode automatique, rien ne change sur VIDAA).

## 2026-10-29 — 1.3.7

- Nouvel accueil (bêta, moteur DOM) : la carte sélectionnée de « Continuer à regarder » ne disparaît plus sur la télé (une règle prévue pour les appareils peu puissants la renvoyait hors de l’écran).
- Nouvel accueil (bêta) : avec le menu latéral en pastille, le contenu commence au même endroit que dans l’accueil actuel ; les premières cartes n’apparaissent plus coupées au bord gauche.
- Le Diagnostic guidé reconnaît les nouvelles cartes « Continuer à regarder » du nouvel accueil.

## 2026-10-27 — 1.3.6

- « Nouvel accueil (bêta) » : choisir le réglage ouvre bien la liste Désactivé / DOM / WebGL dans le navigateur (et sur les télés autres que VIDAA) ; en 1.3.5, le clic ne faisait rien.

## 2026-10-27 — 1.3.5

- Le réglage « Nouvel accueil (bêta) » (Paramètres → Disposition, tout en bas) apparaît aussi dans le navigateur, pas seulement sur la télé.
- Paramètres : les groupes repliables affichent « Ouvert » / « Fermé » en français au lieu de « Open » / « Closed ».

## 2026-10-27 — 1.3.4

- Nouvel accueil (bêta), à activer dans Paramètres → Disposition → « Nouvel accueil (bêta) » (effet au prochain démarrage ; « Désactivé » garde l’accueil actuel). Il reprend tout l’accueil actuel : Continuer à regarder et Next Up, catalogues, collections, « Pour toi », grande bannière avec notes et bande-annonce, appui long, menu latéral, dispositions moderne, grille et classique (touche 76).
- Il est conçu pour la télé : seules les affiches proches de la sélection existent, les images sont chargées à la bonne taille quand tu t’arrêtes, et le retour d’une fiche réutilise l’accueil déjà affiché au lieu de le reconstruire. Un catalogue qui ne répond pas ne bloque plus les rangées suivantes et se recharge tout seul.
- Choix « Activé, WebGL (prototype) » : en disposition moderne, l’accueil est dessiné par la carte graphique, en version plus simple (sans badges ni bande-annonce) ; grille et classique restent en mode DOM, et il y repasse tout seul en cas de souci.
- Police : toute l’interface utilise de nouveau JetBrains Sans, la police du mobile, au lieu d’Arial.

## 2026-10-26 — 1.3.3

- Correctifs officiels intégrés pour la télé : le son ne reste plus coupé après un démarrage lent ou un changement automatique de source, la langue audio préférée est retrouvée même quand les pistes arrivent tard, la lecture reste stable en changeant d’audio ou de sous-titres, et les sources passant par un proxy (MediaFlow) se lisent.
- Lecture : la recherche des pistes audio ne retarde plus le démarrage ; les noms des pistes viennent du fichier quand il les fournit. Le badge « Son non lu par la TV » est retiré (le son coupé ne venait pas du format).
- Bouton Sources du lecteur : la liste ne dessine plus que les sources autour de la sélection, au lieu de toutes d’un coup ; l’ouverture ne gèle plus la télé pendant la lecture.
- Nouveautés officielles : soirée à plusieurs (Watch Party) avec invitations par QR, mode ambiance au repos, lecture aléatoire des épisodes, listes MDBList, affiches personnalisées et synchronisation avec un serveur multimédia.

## 2026-10-21 — 1.3.2

- Navigation plus fluide : le grand bandeau de l’accueil ne se met à jour que quand tu t’arrêtes sur une affiche, sa mise en page n’est plus recalculée à chaque déplacement, et les réglages ne sont plus relus à chaque touche. Les badges des sources s’affichent directement (sans conversion d’image) et ne sont plus tous préchargés au démarrage.
- Son : les pistes audio portent leur vrai nom (langue, format, canaux) au lieu de « Audio 1, Audio 2 ». Une piste que la télé ne sait pas décoder (souvent DTS ou TrueHD) est évitée au démarrage au profit d’une piste lisible ; si aucune ne l’est, un message te propose de choisir une autre source. Dans la liste, ces sources portent le badge « Son non lu par la TV ».
- Quitter la lecture : la vidéo est arrêtée et sa mémoire libérée en premier, pour éviter les plantages au retour.
- « Mon espace » rejoint le menu de la télé : Pour toi, Que regarder ?, Mes goûts, Calendrier, Statistiques et Listes partagées. La télé prépare ses propres recommandations (notes, bibliothèque, visionnage), et les rangées « Pour toi » et « Parce que tu as aimé » apparaissent bien sur l’accueil.
- Que regarder ? tient compte du temps disponible et de l’humeur, avec priorité aux épisodes en cours. Les fiches affichent une prédiction quand le profil est suffisamment renseigné.
- Calendrier des séries suivies et statistiques par période, avec réunion du journal de tes appareils associés. Listes partagées : créer, rejoindre par code, ajouter depuis une fiche, aimer, noter et marquer vu.
- Dates de sortie des épisodes corrigées : une date américaine sans heure (ex. VisionQuest le 20) n’apparaît plus « aujourd’hui » en France ; l’épisode compte comme sorti la nuit suivante. Quand l’heure exacte est connue (TVmaze), le calendrier et « Diffusion demain » l’affichent, par exemple « Diffusion demain · 03:00 ».
- Présentation rapprochée du mobile : couleurs, contrastes et surfaces ; les cinq notes sont regroupées dans un seul bouton pour laisser Lecture bien visible. Les flèches maintenues ne sont plus freinées par un délai fixe.

## 2026-10-19 — 1.3.1

- Typographie et icônes locales : JetBrains Sans et Material Icons sont désormais embarquées directement sur la télé, sans dépendre d'appels réseau Google Fonts externes. Démarrage et affichage plus fluides et réactifs.
- Action « Pas pour moi » : appui long sur une affiche permet désormais de marquer un titre « Pas pour moi » (ou d'annuler le refus) directement sur la télé, synchronisé avec les recommandations personnelles partagées avec le mobile.
- Performances d'affichage : hachage FNV-1a optimisé pour la réconciliation des flux et régulateur anti-patinage de 90 ms sur les répétitions de la télécommande pour un défilement ultra-fluide sans à-coups sur MT9602.
- Optimisations mémoire et fluidité : activation de la virtualisation des listes de flux dès 40 éléments (au lieu de 100), libération instantanée des textures graphiques de flux lors du lancement du lecteur vidéo pour préserver la mémoire du décodeur 4K/HDR, et suspension des notifications réseau superflues lors des défilements continus à la télécommande.

## 2026-10-16 — 1.2.8

- Diagnostic de lecture : chaque source que la télé n'arrive pas à lire (erreur, démarrage trop long, lien refusé) est notée avec la raison exacte, le format annoncé et ce que la télé sait décoder. Visible dans Paramètres → À propos → Console de débogage, et envoyé aux rapports privés de ton espace perso.

## 2026-10-16 — 1.2.7

- Correction : la télé ignorait les envois du téléphone (« Envoyer à la TV » vers Nuvio, « Continuer sur la TV ») et les commandes de la télécommande du téléphone. Ils sont maintenant reçus.

## 2026-10-16 — 1.2.6

- Envoyer un téléchargement du téléphone à la télé : Nuvio sur la télé lit le fichier depuis le téléphone, en Wi-Fi, avec la piste audio et les sous-titres choisis sur le téléphone (sous-titres du fichier ou téléchargés avec la vidéo). Tu peux toujours en changer depuis la télé.

## 2026-10-15 — 1.2.5

- Notes personnelles sur la fiche : cinq boutons (👎👎 Détesté, 👎 Pas pour moi, 😐 Correct, 👍 J’aime, 💜 J’adore) à côté de Lecture. OK sur ta note actuelle la retire. Tes notes sont privées et partagées avec ton téléphone.
- Fin de film ou de saison : la télé te propose de noter, une seule fois (touches 1 à 5, ou flèches puis OK ; Retour pour plus tard).
- Découverte (menu de gauche) : les recommandations calculées par ton téléphone défilent une par une ; → J’aime, ← Pas pour moi, ↑ J’adore, ↓ passer, OK pour ouvrir la fiche.
- Export QR du comparatif v2 : capacité du serveur augmentée pour les bilans complets volumineux ; un export refusé peut être réessayé depuis le parcours déjà ouvert, sans relancer les mesures.
- Comparatif v2 : défilements animés en continu, contrôles de géométrie renforcés et huit répétitions équilibrées pour mieux comparer les moteurs.
- Comparatif des moteurs : correction du chronomètre de réaction, désormais pris au moment réel du rappel du navigateur ; les bilans v2 distinguent ce délai de la cadence des images. Les scènes valides restent comparables même si une autre scène du passage échoue.
- Continuer sur la TV : une vidéo lancée sur le téléphone peut reprendre sur la télé, au même moment. La télé propose « Reprendre ici » quand le téléphone lui envoie la lecture.
- Télécommande depuis le téléphone : lecture, pause, avance et retour, épisode suivant, sous-titres, piste audio, volume et navigation dans les menus, directement depuis l’appli Nuvio du téléphone.
- Espace perso (Paramètres → Avancé → Espace perso) : un code relie la télé à tes autres appareils. Les échanges passent par un serveur sécurisé réservé à tes appareils, avec un mode de secours automatique s’il ne répond pas.
- L’écran Espace perso indique si la télé est reliée au serveur sécurisé ou en mode secours.

## 2026-10-14 — 1.2.5

- Mise à jour du fork vers Nuvio 1.2.5, avec conservation de la connexion au compte Android, du QR code et des protections de lecture VIDAA.
- Découverte : les affiches déjà chargées restent visibles quand la grille se redessine, au lieu de disparaître jusqu’au rechargement.
- Accueil : le logo du titre sélectionné est suivi par les mises à jour incrémentales, pour éviter les logos en double ou orphelins.
- Collections : les filtres numériques TMDB laissés vides restent désactivés au lieu d’être convertis en zéro.
- Fin de lecture : l’objet vidéo Samsung n’est plus consulté sur les autres téléviseurs, ce qui évite des recalculs inutiles.
- Connexion sur webOS : un appui OK suivi d’un clic ne déclenche plus deux fois la même action, et le survol du pointeur n’interrompt plus la saisie au clavier.
- Laboratoire comparatif pour la Hisense 55U6NQ : huit moteurs d’affichage, calculs JavaScript et C++/WebAssembly, parcours court ou complet et export du bilan par code QR. Accessible dans le diagnostic avec « Comparer les moteurs ».
- Sources et badges : les liens déjà affichés sont conservés lorsque la liste défile ou que les badges prennent leur place, pour éviter les reconstructions et chargements d’images répétés.
- Conservation de la sélection et de la position pendant l’ajustement de la hauteur des liens ; restauration du focus lorsqu’un lien est réellement remplacé.
- Préparation des réglages de badges une seule fois pour les nouveaux liens d’une même zone affichée.

## 2026-10-13 — 1.2.4

- Nouveau diagnostic guidé en français : accueil, navigation, fiches, sources et lecture vidéo facultative, avec bilan par étape.
- Parcours automatique : la télé enchaîne seule toutes les étapes (déplacements, appuis prolongés, fiches, liens vidéo, lecture avec avance et sous-titres) ; posez la télécommande, une touche interrompt le parcours.
- Une étape dont l’écran attendu n’a pas été atteint est marquée « incomplète » avec la raison, et la page « Journal du parcours » du bilan liste les décisions du parcours automatique, sans titre ni identifiant.
- Étapes manuelles : le chrono ne démarre plus qu’à votre première action attendue (première flèche sur l’accueil, ouverture d’une fiche, affichage des liens ou lancement de la vidéo).
- Exporter JSON affiche un code QR : le téléphone ouvre le bilan dans son navigateur via un lien court valable 30 minutes ; la télé renvoie le bilan tant que le code reste affiché.
- Relevé des capacités réelles du navigateur, du démarrage, des images, du réseau, du cache Vercel et de la mémoire JavaScript lorsqu’elle est disponible.
- Bilan enregistré uniquement sur la télé, consultable par pages ; aucun lien privé ni identifiant dans les mesures ni dans le fichier exporté.

## 2026-10-12 — 1.2.4

- Fond et logo : fondu entre les images sans passage par un fond sombre, avec une légère arrivée des informations du titre sélectionné.
- Navigation prolongée : positions des cartes réutilisées quand leurs images sont réactivées, avec vérification de leur taille pour garder la sélection bien alignée.
- Correction des petits écarts de hauteur qui pouvaient s’accumuler lors du défilement entre les lignes.

- Accueil plus rapide : les derniers catalogues du profil réapparaissent immédiatement, puis s’actualisent en arrière-plan.
- Catalogues et fiches Xperience/AIOStreams préparés côté Vercel avec un cache court, des données allégées et un retour automatique à la source directe si nécessaire.
- Démarrage accéléré grâce à la réutilisation locale des fichiers de la version installée ; les mises à jour restent vérifiées au lancement.
- Analyse des badges Nard et Elite déplacée dans un traitement séparé sur les télés compatibles pour laisser l’interface répondre.
- Aperçu du film affiché dès l’ouverture d’une fiche, transitions du fond et du logo plus stables et mémoire des catalogues limitée pendant les longues sessions.
- Ajout des vrais badges graphiques Xperience Nard et Elite, avec un choix indépendant pour chaque profil dans Paramètres → Style Fusion → Pack de badges.
- Badges Xperience servis en petite taille sur Vercel pour préserver la fluidité ; le pack Nard est proposé par défaut.
- Mise à jour du fork vers Nuvio 1.2.4, avec conservation de la connexion au compte Android et du QR code.
- Retour des animations au survol des cartes studios et plateformes de streaming ; les animations des cartes quittées sont arrêtées.
- Changement plus rapide du fond, du logo et des informations quand on sélectionne une nouvelle carte.
- Affichage des badges des liens vidéo AIOStreams/TorBox, selon les informations disponibles dans chaque source.
- Transitions légères et retour visuel plus doux sur les cartes, les menus et les pages, avec conservation des gains de fluidité.
- Pause pendant le chargement corrigée pour éviter un changement de source intempestif.
- Ce changelog en français apparaît à chaque lancement de Nuvio personnel sur la télé.

## 2026-10-11 — 1.2.3

- Connexion au compte Nuvio Android par QR code ou e-mail et mot de passe.
- Images plus légères, chargement des catalogues par petits groupes et démarrage allégé.
- Navigation optimisée avec moins de calculs répétitifs et moins de cartes hors écran actives.
