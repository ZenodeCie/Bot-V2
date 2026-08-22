# ZenodeBots — VM Host

Agent d’orchestration multi-bots pour une VM Linux. Un process **host** reste allumé, parle au core `dfb-vm-core` (WebSocket + REST), et lance **N process Discord isolés** via PM2.

Le bot Discord (commandes, modules, events) est un **template** : chaque instance lit `configs/{bot_id}.json` et n’active que `config.modules`.

Ce dépôt n’implémente pas le site, Mongo du core, OAuth, ni le load-balancer. L’agent est un **client**.

## Architecture

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

## Prérequis

- Ubuntu (ou autre Linux) avec **Node.js 18+** (20 recommandée)
- **PM2** déjà installé (`pm2 -v`). Inutile de relancer `npm install -g pm2` si la commande existe (sur cette VM elle est dans `/usr/bin/pm2`, installée en root → `EACCES` en user).
- Accès réseau vers le core (`API_PORT` prod = 3000)
- Une clé `API_KEY` = `API_KEY_VM_BOTS_FREE` ou `API_KEY_VM_BOTS_PREMIUM` du core
- Un fichier **`.env` à la racine du repo** (obligatoire avant `pm2 start`)

Activez les **Privileged Gateway Intents** (Message Content, Server Members, Presence) sur chaque application Discord. Le template loggue clairement les erreurs d’intents (le dashboard du core parse ces logs).

## Identité de la VM

| Variable | Exemple | Rôle |
| --- | --- | --- |
| `VM_HOST` | `vm-freebots-01` | Identifiant **unique** de cette machine. Le core route les commandes avec ça. |
| `VM_TYPE` | `vm-bots-free` | `vm-bots-free` ou `vm-bots-premium` |
| `CORE_API_URL` | `http://IP:3000` | API REST du core |
| `CORE_WS_URL` | `ws://IP:3000/ws` | Même host/port, path `/ws` |
| `API_KEY` | *(secret)* | Header `X-API-Key` + query WS `apiKey` |

Convention des noms :

- free : `vm-freebots-01`, `vm-freebots-02`, …
- premium : `vm-bots-premium`

Sans `vmHost` dans l’URL WS, la VM est invisible pour les start/stop ciblés.

## Installation

```bash
git clone https://github.com/ZenodeCie/Bot-V2.git
cd Bot-V2
npm install
cp .env.example .env
```

Éditez `.env` (ne le commitez jamais) :

```env
CORE_API_URL=http://IP_OU_HOST:3000
CORE_WS_URL=ws://IP_OU_HOST:3000/ws
API_KEY=...
VM_HOST=vm-freebots-01
VM_TYPE=vm-bots-free
CONFIGS_DIR=./configs
BOT_ENTRY=dist/bot/index.js
```

`MONGODB_URI` est **optionnelle**. Si elle est définie, tous les process bots partagent la même base (`MONGODB_DB`, défaut `znd`) et isolent leurs documents avec le champ `botId`. L’agent host ne se connecte pas à Mongo.

Les anciennes bases `znd_{bot_id}` peuvent être fusionnées une fois (bots arrêtés) :

```bash
npm run migrate:mongo
```

Compilez, créez `.env`, puis lancez **uniquement l’agent** :

```bash
npm run build
cp .env.example .env   # puis éditer CORE_*, API_KEY, VM_HOST
pm2 start ecosystem.config.cjs
pm2 save
```

Si `pm2 -v` échoue :

```bash
sudo npm install -g pm2
```

`pm2 startup` n’est utile que si systemd n’est pas déjà branché. S’il affiche une commande `sudo env PATH=... pm2 startup systemd`, copiez-la une fois. Ne relancez pas `npm i -g pm2` à chaque déploiement.

Vérifier que l’agent **reste** online (pas `errored`) :

```bash
pm2 ls
pm2 logs zenode-vm-host --lines 50 --nostream
```

S’il crash sur `Missing required environment variable CORE_API_URL`, le `.env` est absent ou pas lu (cwd PM2 = racine du repo).

Les bots n’apparaissent dans `ecosystem.config.cjs` **jamais**. Ils sont créés par l’agent :

```bash
pm2 start dist/bot/index.js --force --name "{pm2Name}" --max-memory-restart {max_memory}M -- --config "{abs}/configs/{bot_id}.json"
```

Nom PM2 = `bot_id` normalisé (`bot00019` → `bot00019`).

## Comportement

Au boot, l’agent :

1. Vérifie Node 18+ et `pm2 -v`
2. Ouvre le WS : `{CORE_WS_URL}?apiKey={API_KEY}&vmHost={VM_HOST}`
3. `GET /health` puis `GET /api/v1/bots/vm/{VM_HOST}`
4. Stop/delete les process PM2 « bots » **non assignés** à cette VM (anti-doublon)
5. Démarre la boucle stats (15 s) et real-status (25 s, limité ~90 req/min)
6. **Ne démarre pas** tous les bots assignés (`AUTO_START_ASSIGNED=false` par défaut)

Commandes core (`type: bot_command`) :

| Action | Effet |
| --- | --- |
| `start` | Écrit la config si fournie, refuse si le bot tourne déjà ailleurs (`GET /hosted`), `pm2 start`, WS `starting` puis `online` (process up, **pas** Discord ready) + REST `/status` |
| `stop` | `pm2 stop` + `delete`, idempotent, `offline` |
| `restart` | Delete PM2 puis start (process neuf, après un `config_upload`) |
| `delete` | `pm2 delete` + suppression du JSON local |

`config_upload` : écrit `configs/{bot_id}.json` (chmod 600), **ne démarre pas**, répond `config_received`.

`bot_logs_request` : `pm2 logs` sous 15 s, renvoie le `request_id` tel quel.

Heartbeat Discord : `data/{bot_id}/runtime.json` (toutes les 5 s). Fichier > 30 s → `discord_ready=false`. Le dashboard n’affiche « En ligne » que si `really_online` arrive en REST.

## Modules (clés core)

`Base` est toujours chargé. Les autres clés de `config.modules` sont mappées ainsi :

| Clé core | Dans ce repo |
| --- | --- |
| `Base` | help, ping, prefix, commandes `dev`, events ready / messageCreate / interactionCreate |
| `Utilities` | userinfo, emoji |
| `Moderation` | `commands/moderation` + `events/moderation` |
| `ModerationAvancee` | `commands/antiraid` + `events/antiraid` |
| Autres clés core (Giveaway, Tickets, …) | no-op + warning, pas de crash |

## Données & secrets

- `configs/` : JSON avec **tokens Discord** — gitignoré, dossier `700`, fichiers `600`
- `data/{bot_id}/` : runtime + état disque du bot, jamais partagé entre bots
- `API_KEY` uniquement en variable d’environnement
- Health HTTP optionnel : `HOST_HEALTH_PORT=9100` → `127.0.0.1` uniquement

## Tests manuels

1. Agent up → le core voit la VM (`getIndividualVMs` / staff infra).
2. POST stats → la VM apparaît avec 0 bots.
3. `config_upload` create → fichier écrit, `config_received`.
4. `bot_command start` → process PM2, Discord ready, `really_online=true`.
5. `logs_request` → stdout non vide.
6. `stop` → plus de process, dashboard hors ligne.
7. `restart` → nouveau pid, config rechargée.
8. `delete` → plus de process ni de fichier.
9. Couper le WS 10 s → reconnect, stats, bots toujours up.
10. Deuxième agent / autre `VM_HOST` : un start sur A n’apparaît pas sur B.

## Scripts

| Script | Action |
| --- | --- |
| `npm run build` | Compile TypeScript vers `dist/` |
| `npm start` | Lance l’agent (`dist/host/index.js`) |
| `npm run start:bot` | Template seul (exige `--config`) |
| `npm run pm2:start` | `pm2 start ecosystem.config.cjs` |

## Dépannage

| Symptôme | Vérification |
| --- | --- |
| Agent quitte au boot | `CORE_API_URL`, `CORE_WS_URL`, `API_KEY`, `VM_HOST` dans `.env` à la racine. Relancer : `pm2 restart zenode-vm-host` |
| `EACCES` sur `npm install -g pm2` | PM2 est déjà installé en root. Utilisez `pm2 -v`. Mise à jour : `sudo npm install -g pm2` |
| VM invisible au core | Query WS `vmHost` + ping avec `vm_host` ; même host/port que l’API |
| Bot PM2 up mais dashboard « hors ligne » | `data/{bot_id}/runtime.json` et POST `/real-status` (`really_online`) |
| Privileged Intents | Portail Discord → Bot → intents ; logs `Privileged Intents error` |
| Doublon bot_id | Le core envoie `stop` partout ; cette VM refuse un start si `/hosted` dit « ailleurs » |
| `pm2: command not found` | `sudo npm install -g pm2` |

## Sécurité

- Ne versionnez jamais `.env` ni `configs/*.json`
- Révoquez un token Discord exposé
- N’ouvrez pas de HTTP public : l’agent est client du core
