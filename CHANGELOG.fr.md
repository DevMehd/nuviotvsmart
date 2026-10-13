# Nuvio personnel — Historique des modifications

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
