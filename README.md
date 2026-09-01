# ZenodeBots — VM Host

![version](https://img.shields.io/badge/version-2.1.5-blue) ![Node](https://img.shields.io/badge/node-18%2B-green)

Agent d'orchestration multi-bots pour une VM Linux. Un process **host** reste allumé, parle au core `dfb-vm-core` (WebSocket + REST), et lance **N process Discord isolés** via PM2.

Le bot Discord (commandes, modules, events) est un **template** : chaque instance lit `configs/{bot_id}.json` et n'active que `config.modules`.

> 🇬🇧 English version: [README_en.md](README_en.md)

---

## 1. Qui fait quoi ? (Worker ↔ Core)

Le système est découpé en **deux rôles** sur des machines (VM) différentes :

| Rôle | Machine | Rôle dans le système |
| --- | --- | --- |
| **Core** | `dfb-vm-core` | Le **cerveau** : le site, la base MongoDB centrale, l'OAuth, le load-balancer. Il **décide** quels bots tournent où et leur envoie des ordres. |
| **Worker** (ce dépôt) | `vm-freebots-01`, … | Le **bras** : héberge et lance les bots Discord. Il **exécute** les ordres reçus du Core. |

Ce dépôt n'implémente **pas** le Core : il n'est qu'un **client** (l'agent Worker se connecte au Core).

### Comment les deux VM communiquent

Deux canaux sont utilisés, tous deux configurés dans `.env` :

```text
                     ┌───────────────────────┐
                     │     VM CORE (cerveau)  │
                     │  REST API : :3000      │
                     │  WebSocket: :3000/ws   │
                     └───────┬───────────▲────┘
                             │           │
                      REST   │           │  WebSocket (ordres temps réel)
                      (HTTP) │           │  (start/stop/restart/delete,
                             │           │   config_upload, logs…)
                     ┌───────▼───────────┴────┐
                     │  VM WORKER (bras)      │
                     │  Agent host (PM2)      │
                     │   └── bot A (PM2)      │
                     │   └── bot B (PM2)      │
                     └────────────────────────┘
```

- **REST (HTTP)** : le Worker fait des requêtes normales vers le Core (health, stats, statut réel des bots). Variable : `CORE_API_URL`.
- **WebSocket** : connexion **permanente** qui reste ouverte. Le Core pousse ses ordres à travers (démarrage/arrêt de bots, upload de config, demande de logs) et le Worker répond en direct. Variable : `CORE_WS_URL` (calculée automatiquement depuis `CORE_API_URL` si absente).

À chaque échange, le Worker s'identifie avec deux éléments du `.env` :
- `API_KEY` → la clé utilisateur (liée à `VM_TYPE` : free ou premium).
- `VM_HOST` → le **nom unique** de cette machine, qui permet au Core de router les ordres vers **cette** VM précise.

> ⚠️ Sans `VM_HOST` correct dans l'URL WebSocket, la VM est invisible pour les start/stop ciblés par le Core.

---

## 2. Modes de démarrage (en un coup d'œil)

Le projet peut être lancé de plusieurs façons selon le contexte. Voici une table récapitulative, détaillée plus bas.

| Mode | Commande | Compile ? | Pour quoi faire ? |
| --- | --- | --- | --- |
| **Build** | `npm run build` | ✅ | Compile TypeScript → `dist/` |
| **Host (prod, via PM2)** | `npm run pm2:start` | ❌ (avant : build) | L'agent complet connecté au Core, qui gère N bots. |
| **Host (prod, direct)** | `npm start` | ❌ (avant : build) | L'agent complet sans PM2 wrapper. |
| **Dev (watch)** | `npm run dev` | ✅ (continu) | Compile en continu pendant que vous codez. |
| **Bot seul (alone)** | `npm run start:alone` | ✅ (compile avant) | Un bot, sans Core ni agent (dév/test local). |
| **Bot seul (alone wb)** | `npm run start:alone:wb` | ❌ (wb = without build) | Idem mais sans recompiler (lance le `dist/` existant). |

> `wb` = **w**ithout **b**uild (sans compilation). Utile pour relancer vite un `dist/` déjà compilé sans attendre `tsc`.

---

### 2.1 Mode dev (développement)

But : compiler en continu pendant que vous modifiez le code.

```bash
npm run dev        # lance "tsc --watch" : recompile automatiquement à chaque sauvegarde
```

> `dev` compile **en continu** mais ne lance rien. Lancez ensuite vos process dans un autre terminal :
> - l'agent host : `npm start`
> - ou un bot seul : `npm run start:alone` / `npm run start:alone:wb`

### 2.2 Mode production (agent host connecté au Core)

But : l'agent complet, connecté au Core, qui orchestre N bots en PM2.

```bash
# 1. Compiler une fois
npm run build

# 2. Créer / compléter le .env (voir plus bas)
cp .env.example .env

# 3. Lancer l'agent via PM2 (recommandé en prod)
npm run pm2:start
pm2 save          # pour que PM2 le relance au reboot

# Alternative : lancer direct sans PM2 (moins recommandé en prod)
npm start
```

Vérifier que l'agent **reste** online (pas `errored`) :

```bash
pm2 ls
pm2 logs zenode-vm-host --lines 50 --nostream
```

Si le job crash sur `Missing required environment variable CORE_API_URL`, le `.env` est absent ou pas lu (le dossier courant de PM2 doit être la racine du repo).

> ⚠️ Le `.env` doit être **à la racine du repo** et complété **avant** `pm2 start`.

Scripts PM2 utiles :

```bash
npm run pm2:stop     # arrête l'agent
npm run pm2:logs     # suit les logs de l'agent
pm2 restart zenode-vm-host   # après une modif du .env
```

### 2.3 Mode "alone" (un seul bot, sans Core ni agent)

But : tester **un** bot en local, sans la VM Core ni l'agent host. Utile en développement.

Ce mode lit le token et la config directement dans le `.env` (variables de la section C), et **pas** dans `configs/{bot_id}.json`.

```bash
# Compile puis lance le bot en mode alone
npm run start:alone

# Sans recompiler (lance le dist/ déjà construit)
npm run start:alone:wb
```

Prérequis en mode alone (variables de la section C du `.env`) :
- `BOT_TOKEN` → obligatoire.
- `PREFIX`, `BOT_NAME`, `BOT_STATUS`, `BOT_COLOR`, `MODULES` → optionnels.
- `OWNER_ID` → IDs Discord admin (commandes dev).

En mode alone, le `--config` est ignoré : si vous voulez relancer un bot avec sa config de fichier, utilisez plutôt `npm run start:bot -- --config configs/{bot_id}.json`.

---

## 3. Prérequis

- Ubuntu (ou autre Linux) avec **Node.js 18+** (20 recommandée).
- **PM2** déjà installé (`pm2 -v`). Pas besoin de relancer `npm install -g pm2` si la commande existe (sur cette VM elle est dans `/usr/bin/pm2`, installée en root → `EACCES` en user). Sinon : `sudo npm install -g pm2`.
- Accès réseau vers le Core (`API_PORT` en prod = 3000).
- Une clé `API_KEY` = `API_KEY_VM_BOTS_FREE` ou `API_KEY_VM_BOTS_PREMIUM` du Core.
- Un fichier **`.env` à la racine du repo** (obligatoire avant `pm2 start`).

Activez les **Privileged Gateway Intents** (Message Content, Server Members, Presence) sur chaque application Discord. Le template loggue clairement les erreurs d'intents (le dashboard du Core parse ces logs).

---

## 4. Installation

```bash
git clone https://github.com/ZenodeCie/Bot-V2.git
cd Bot-V2
npm install
cp .env.example .env    # puis éditez le .env
```

Éditez `.env` (étape détaillée dans le fichier lui-même, tout est commenté). Variables essentielles :

```env
CORE_API_URL=http://IP_OU_HOST:3000
CORE_WS_URL=ws://IP_OU_HOST:3000/ws    # optionnel, calculé si absent
API_KEY=...
VM_HOST=vm-freebots-01
VM_TYPE=vm-bots-free
```

Ne **commitez jamais** `.env` ni `configs/*.json` (comme `.gitignore` le prévoit).

`MONGODB_URI` est **optionnelle**. Si elle est définie, tous les process bots partagent la même base (`MONGODB_DB`, défaut `znd`) et isolent leurs documents avec le champ `botId`. L'agent host ne se connecte pas à Mongo.

Les anciennes bases `znd_{bot_id}` peuvent être fusionnées une fois (bots arrêtés) :

```bash
npm run migrate:mongo
```

---

## 5. Architecture

```text
src/
├── host/                 # Agent VM (process principal, PM2 name = zenode-vm-host)
│   ├── index.ts          # Boot, health, orphan cleanup, boucles stats
│   ├── protocol.ts       # Payloads WS/REST typés (source de vérité)
│   ├── wsClient.ts       # WS core + ping 25s + reconnect exponentiel
│   ├── restClient.ts     # REST X-API-Key
│   ├── pm2Manager.ts     # start/stop/restart/delete/logs (execFile, jamais le shell)
│   ├── handlers.ts       # bot_command, config_upload, bot_logs_request
│   └── reporter.ts       # POST /vms/stats + /real-status
├── bot/                  # Template Discord (1 process PM2 par bot)
│   ├── index.ts          # --config, modules, heartbeat, graceful shutdown
│   ├── config.ts         # Token / prefix / color depuis le JSON (pas de BOT_TOKEN .env)
│   ├── modules.ts        # Mapping clés core → dossiers du repo
│   └── commands|events|utils
└── shared/               # bot_id, forme du JSON config
```

Chaque bot = un fork PM2, un token, un plafond RAM (`--max-memory-restart`). Pas de client discord.js multiplexé.

---

## 6. Comportement de l'agent host

Au boot, l'agent :

1. Vérifie Node 18+ et `pm2 -v`.
2. Ouvre le WebSocket : `{CORE_WS_URL}?apiKey={API_KEY}&vmHost={VM_HOST}`.
3. `GET /health` puis `GET /api/v1/bots/vm/{VM_HOST}`.
4. Stop/delete les process PM2 « bots » **non assignés** à cette VM (anti-doublon).
5. Démarre la boucle stats (30 s) et real-status (gap ~120 s, max 6 POST/tick, backoff 429).
6. **Ne démarre pas** tous les bots assignés (`AUTO_START_ASSIGNED=false` par défaut).

Commandes core (`type: bot_command`) :

| Action | Effet |
| --- | --- |
| `start` | Écrit la config si fournie, refuse si le bot tourne déjà ailleurs (`GET /bots/:id`), `pm2 start`, WS `starting` puis `online` (process up, **pas** Discord ready) + REST `/status` (best-effort). |
| `stop` | `pm2 stop` + `delete`, idempotent, `offline`. |
| `restart` | Delete PM2 puis start (process neuf, après un `config_upload`). |
| `delete` | `pm2 delete` + suppression du JSON local. |

`config_upload` : écrit `configs/{bot_id}.json` (chmod 600), **ne démarre pas**, répond `config_received`.

`bot_logs_request` : `pm2 logs` sous 15 s, renvoie le `request_id` tel quel.

Les bots n'apparaissent **jamais** dans `ecosystem.config.cjs` : ils sont créés par l'agent :

```bash
pm2 start dist/bot/index.js --force --name "{pm2Name}" --max-memory-restart {max_memory}M -- --config "{abs}/configs/{bot_id}.json"
```

Nom PM2 = `bot_id` normalisé (`bot00019` → `bot00019`).

Heartbeat Discord : `data/{bot_id}/runtime.json` (toutes les 5 s). Fichier > 30 s → `discord_ready=false`. Le dashboard n'affiche « En ligne » que si `really_online` arrive en REST.

---

## 7. Modules (clés core)

`Base` est toujours chargé. Les autres clés de `config.modules` sont mappées ainsi :

| Clé core | Dans ce repo |
| --- | --- |
| `Base` | help, ping, prefix, commandes `dev`, events ready / messageCreate / interactionCreate |
| `Utilities` | userinfo, emoji |
| `Moderation` | `commands/moderation` + `events/moderation` |
| `ModerationAvancee` | `commands/antiraid` + `events/antiraid` |
| Autres clés core (Giveaway, Tickets, …) | no-op + warning, pas de crash |

---

## 8. Données & secrets

- `configs/` : JSON avec **tokens Discord** — gitignoré, dossier `700`, fichiers `600`.
- `data/{bot_id}/` : runtime + état disque du bot, jamais partagé entre bots.
- `API_KEY` uniquement en variable d'environnement.
- Health HTTP optionnel : `HOST_HEALTH_PORT=9100` → `127.0.0.1` uniquement.

---

## 9. Scripts npm

| Script | Action |
| --- | --- |
| `npm run build` | Compile TypeScript vers `dist/` |
| `npm run dev` | Compile en continu (watch) |
| `npm start` | Lance l'agent host (`dist/host/index.js`) |
| `npm run start:bot` | Template seul (exige `--config`) |
| `npm run start:alone` | Compile + lance un bot seul (mode alone) |
| `npm run start:alone:wb` | Lance un bot seul sans recompiler (wb) |
| `npm run pm2:start` | `pm2 start ecosystem.config.cjs` |
| `npm run pm2:stop` | `pm2 stop zenode-vm-host` |
| `npm run pm2:logs` | `pm2 logs zenode-vm-host` |
| `npm run migrate:mongo` | Compile + fusionne les anciennes bases mongo |

---

## 10. Tests manuels

1. Agent up → le Core voit la VM (`getIndividualVMs` / staff infra).
2. POST stats → la VM apparaît avec 0 bots.
3. `config_upload` create → fichier écrit, `config_received`.
4. `bot_command start` → process PM2, Discord ready, `really_online=true`.
5. `logs_request` → stdout non vide.
6. `stop` → plus de process, dashboard hors ligne.
7. `restart` → nouveau pid, config rechargée.
8. `delete` → plus de process ni de fichier.
9. Couper le WS 10 s → reconnect, stats, bots toujours up.
10. Deuxième agent / autre `VM_HOST` : un start sur A n'apparaît pas sur B.

---

## 11. Dépannage

| Symptôme | Vérification |
| --- | --- |
| Agent quitte au boot | `CORE_API_URL`, `CORE_WS_URL`, `API_KEY`, `VM_HOST` dans `.env` à la racine. Relancer : `pm2 restart zenode-vm-host` |
| `EACCES` sur `npm install -g pm2` | PM2 est déjà installé en root. Utilisez `pm2 -v`. Mise à jour : `sudo npm install -g pm2` |
| VM invisible au Core | Query WS `vmHost` + ping avec `vm_host` ; même host/port que l'API |
| Bot PM2 up mais dashboard « hors ligne » | `data/{bot_id}/runtime.json` et POST `/real-status` (`really_online`) |
| Privileged Intents | Portail Discord → Bot → intents ; logs `Privileged Intents error` |
| Doublon bot_id | Le Core envoie `stop` partout ; cette VM refuse un start si `GET /bots/:id` indique une autre VM active |
| Flood `429 Trop de requêtes` | Normal si trop de bots reportent trop vite ; l'agent applique un backoff et ralentit real-status. Vérifier que le Core rate-limit n'est pas trop bas pour le nombre de bots |
| `pm2: command not found` | `sudo npm install -g pm2` |

---

## 12. Sécurité

- Ne versionnez jamais `.env` ni `configs/*.json`.
- Révoquez un token Discord exposé.
- N'ouvrez pas de HTTP public : l'agent est client du Core.
