# Nuvio personnel — Historique des modifications

## 2026-10-19 — 1.3.0

- « Mon espace » rejoint le menu de la télé : Pour toi, Que regarder ?, Mes goûts, Calendrier, Statistiques et Listes partagées.
- La télé prépare ses propres recommandations à partir des notes, de la bibliothèque et du visionnage. Les résultats enregistrés restent accessibles pendant l’actualisation.
- Que regarder ? tient compte du temps disponible et de l’humeur, avec priorité aux épisodes en cours. Les fiches affichent une prédiction quand le profil est suffisamment renseigné.
- Calendrier des séries suivies et statistiques par période, avec réunion du journal de tes appareils associés. Les pauses et déplacements dans une vidéo ne gonflent pas le temps regardé.
- Listes partagées : créer, rejoindre par code, ajouter depuis une fiche, aimer, noter et marquer vu. Les changements hors connexion restent en attente d’envoi.
- « Pas pour moi » : un appui long sur une affiche permet de refuser un titre (ou d’annuler le refus), synchronisé avec tes recommandations sur le téléphone.
- Présentation rapprochée du mobile : couleurs, contrastes, surfaces et animations courtes. Les cinq notes sont regroupées dans un seul bouton pour laisser Lecture bien visible. Polices et icônes embarquées dans l’application (plus de chargement depuis Google Fonts).
- Liste des sources : seules les lignes modifiées sont redessinées, la liste est allégée dès 40 sources et libérée à l’ouverture du lecteur.
- Retour à la sélection de Mon espace, isolation par profil et délais de synchronisation bornés. Les contrôles de lecture depuis le téléphone restent disponibles.

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
