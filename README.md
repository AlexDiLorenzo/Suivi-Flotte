# Flotte — Montpellier Dépannage

Application de suivi de la flotte de véhicules : tableau de bord du planning des
contrôles techniques et historique des interventions de chaque véhicule.

## Fonctionnalités

- **Tableau de bord** reproduisant le fichier `Planning_CT_Flotte.xlsx` :
  10 catégories colorées, colonnes Marque / Modèle / Immatriculation / 1ère MEC
  et planning des contrôles techniques sur 12 mois.
- **Ajout de véhicule** dans chaque catégorie via un formulaire clair.
- **Fiche véhicule** : carte d'identité (immatriculation, 1ère MEC, n° de série,
  date du CT, notes) et **historique complet des interventions**.
- **Interventions** : date, kilométrage, mécanicien(s) et lignes de pièces
  (type, désignation, fournisseur, quantité, prix unitaire) avec total HT
  automatique. Ajout, modification, suppression.
- **Documents** : cartes grises et cartes blanches (autorisation de mise en
  service) stockées par véhicule, avec **suivi des dates de fin de validité**
  (pastille J-xx, alerte à 90 et 30 jours). Consultation dans l'application,
  téléchargement, et **import en masse** d'un lot de fichiers rattachés
  automatiquement par immatriculation lue dans le nom du fichier.
- **Présence Pérols** : feuille de présence hebdomadaire (gestion de l'équipe,
  tableau NOM × jours avec codes de présence), enregistrement automatique.
- **Impression** des tableaux (flotte et présence) et **envoi automatique** à
  `compta@montpellierdepannage.com` (via Resend).
- Connexion sécurisée (JWT), données partagées via PostgreSQL.

## Démarrage en local

```bash
# 1. Base de données + API
cd api
npm install
DB_HOST=localhost DB_PASSWORD=motdepasse node server.js

# 2. Frontend (autre terminal)
npm install
npm run dev          # http://localhost:5173
```

Le serveur Vite redirige `/api` vers `http://localhost:3000`.

## Déploiement (Docker)

```bash
cp .env.example .env     # renseigner FL_DB_PASSWORD et FL_JWT_SECRET
docker compose up -d --build
```

Trois conteneurs : `flotte-front` (nginx), `flotte-api` (Node), `flotte-db`
(PostgreSQL). À la première connexion, l'application propose de créer le compte
administrateur.

## Données de départ

L'application est livrée avec le contenu des deux fichiers Excel de référence :
l'ensemble des véhicules de la flotte et l'historique d'interventions du
porte-voitures `AM-026-AW`. Ces données sont insérées automatiquement dans une
base vide (`api/seedData.js`).
