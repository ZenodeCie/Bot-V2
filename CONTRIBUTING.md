# Contributing to Bot-V2

Merci de vouloir contribuer à **ZenodeBots — VM Host** ! Ce document décrit les règles à suivre pour proposer des changements.

## Règle d'or : pas de commit direct sur `master`

`master` est la branche stable. **Aucun développement, commit ou push direct n'y est autorisé.**

Tout le travail doit se faire sur une branche alternative :

- `feature/ma-fonctionnalite` — pour une nouvelle fonctionnalité
- `fix/mon-correctif` — pour un correctif de bug
- `origin/koan` — branche de développement partagée du projet

Les changements arrivent sur `master` uniquement via une **Pull Request** revue et approuvée.

## Workflow

1. **Fork / clone** le dépôt.

   ```bash
   git clone https://github.com/ZenodeCie/Bot-V2.git
   cd Bot-V2
   ```

2. **Créez votre branche** à partir de `master` (ou de `koan` si vous partez d'un travail en cours) :

   ```bash
   git checkout master
   git pull origin master
   git checkout -b feature/ma-fonctionnalite
   ```

   Pour travailler directement sur la branche partagée :

   ```bash
   git checkout -b koan origin/koan
   git pull origin koan
   ```

3. **Installez les dépendances et configurez l'environnement** (voir le [README](README.md)) :

   ```bash
   npm install
   cp .env.example .env
   ```

4. **Développez** sur votre branche. Compilez régulièrement pour vérifier que tout passe :

   ```bash
   npm run build
   ```

5. **Committez** avec des messages clairs et atomiques (un commit = un changement logique).

   ```bash
   git add .
   git commit -m "feat: description courte du changement"
   ```

6. **Poussez votre branche** (jamais `master`) :

   ```bash
   git push origin feature/ma-fonctionnalite
   ```

7. **Ouvrez une Pull Request** vers `master` (ou vers `koan` selon le contexte du changement) en décrivant :
   - le problème résolu / la fonctionnalité ajoutée
   - comment tester le changement
   - tout impact sur `configs/`, `ecosystem.config.cjs`, ou le protocole WS/REST avec le core

## Convention de nommage des branches

| Préfixe      | Usage                                      |
| ------------ | ------------------------------------------- |
| `feature/…`  | Nouvelle fonctionnalité                     |
| `fix/…`      | Correction de bug                           |
| `refactor/…` | Refactorisation sans changement de comportement |
| `docs/…`     | Documentation uniquement                    |
| `koan`       | Branche de développement partagée du projet |

## Ce qu'il ne faut jamais commiter

- `.env`
- `configs/*.json` (contiennent des tokens Discord)
- `data/` (état runtime des bots)
- Toute clé (`API_KEY`, `MONGODB_URI`, etc.)

Si un secret a été poussé par erreur, révoquez-le immédiatement (token Discord, clé API) puis prévenez un mainteneur.

## Style de code

- Le projet est en **TypeScript**. Respectez la structure existante (`src/host`, `src/bot`, `src/shared`).
- `protocol.ts` est la source de vérité pour les payloads WS/REST : toute modification du protocole doit y être répercutée en premier.
- Pas d'utilisation du shell dans `pm2Manager.ts` (`execFile` uniquement, jamais de `exec`/`spawn` shell).
- Vérifiez que `npm run build` passe sans erreur avant d'ouvrir une PR.

## Revue et fusion

- Toute PR vers `master` doit être revue avant fusion.
- Les tests manuels listés dans le [README](README.md#tests-manuels) doivent être vérifiés pour tout changement touchant à l'agent host, au cycle de vie PM2, ou à la communication avec le core.
- En cas de doute sur une modification du protocole (`protocol.ts`) ou du comportement de démarrage/arrêt des bots, ouvrez d'abord une issue pour en discuter.

## Questions

Ouvrez une [issue](https://github.com/ZenodeCie/Bot-V2/issues) pour toute question ou proposition avant de partir sur un gros changement.