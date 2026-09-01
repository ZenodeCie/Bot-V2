# ZenodeBots — VM Host

![version](https://img.shields.io/badge/version-2.1.5-blue) ![Node](https://img.shields.io/badge/node-18%2B-green)

Multi-bot orchestration agent for a Linux VM. A **host** process stays alive, talks to the `dfb-vm-core` (WebSocket + REST), and launches **N isolated Discord processes** via PM2.

The Discord bot (commands, modules, events) is a **template**: each instance reads `configs/{bot_id}.json` and only enables `config.modules`.

> 🇫🇷 Version française : [README.md](README.md)

---

## 1. Who does what? (Worker ↔ Core)

The system is split into **two roles** running on different VMs:

| Role | Machine | Role in the system |
| --- | --- | --- |
| **Core** | `dfb-vm-core` | The **brain**: the website, central MongoDB, OAuth, load-balancer. It **decides** which bots run where and sends them orders. |
| **Worker** (this repo) | `vm-freebots-01`, … | The **arms**: hosts and launches the Discord bots. It **executes** the orders received from the Core. |

This repo does **not** implement the Core: it is only a **client** (the Worker agent connects to the Core).

### How the two VMs talk to each other

Two channels are used, both configured in `.env`:

```text
                     ┌───────────────────────┐
                     │     VM CORE (brain)    │
                     │  REST API : :3000      │
                     │  WebSocket: :3000/ws   │
                     └───────┬───────────▲────┘
                             │           │
                      REST   │           │  WebSocket (real-time orders)
                      (HTTP) │           │  (start/stop/restart/delete,
                             │           │   config_upload, logs…)
                     ┌───────▼───────────┴────┐
                     │  VM WORKER (arms)      │
                     │  Host agent (PM2)      │
                     │   └── bot A (PM2)      │
                     │   └── bot B (PM2)      │
                     └────────────────────────┘
```

- **REST (HTTP)**: the Worker makes normal requests to the Core (health, stats, real bot status). Variable: `CORE_API_URL`.
- **WebSocket**: a **persistent** connection that stays open. The Core pushes its orders through it (start/stop bots, config upload, log requests) and the Worker replies in real time. Variable: `CORE_WS_URL` (auto-derived from `CORE_API_URL` if absent).

At every exchange, the Worker identifies itself with two `.env` values:
- `API_KEY` → the user key (linked to `VM_TYPE`: free or premium).
- `VM_HOST` → the **unique name** of this machine, which lets the Core route orders to **this** exact VM.

> ⚠️ Without a correct `VM_HOST` in the WebSocket URL, the VM is invisible to targeted start/stop from the Core.

---

## 2. Startup modes (at a glance)

The project can be launched several ways depending on the context. Summary table, detailed below.

| Mode | Command | Compiles? | What for? |
| --- | --- | --- | --- |
| **Build** | `npm run build` | ✅ | Compiles TypeScript → `dist/` |
| **Host (prod, via PM2)** | `npm run pm2:start` | ❌ (run build before) | Full agent connected to the Core, managing N bots. |
| **Host (prod, direct)** | `npm start` | ❌ (run build before) | Full agent without PM2 wrapper. |
| **Dev (watch)** | `npm run dev` | ✅ (continuous) | Compiles continuously while you code. |
| **Single bot (alone)** | `npm run start:alone` | ✅ (compiles first) | One bot, without Core or agent (local dev/test). |
| **Single bot (alone wb)** | `npm run start:alone:wb` | ❌ (wb = without build) | Same but without recompiling (runs the existing `dist/`). |

> `wb` = **w**ithout **b**uild. Handy to quickly restart an already-compiled `dist/` without waiting for `tsc`.

---

### 2.1 Dev mode

Purpose: compile continuously while you change the code.

```bash
npm run dev        # runs "tsc --watch": recompiles automatically on every save
```

> `dev` compiles **continuously** but does not run anything. Launch your processes in another terminal afterwards:
> - the host agent: `npm start`
> - or a single bot: `npm run start:alone` / `npm run start:alone:wb`

### 2.2 Production mode (host agent connected to the Core)

Purpose: the full agent, connected to the Core, orchestrating N bots in PM2.

```bash
# 1. Compile once
npm run build

# 2. Create / complete the .env (see below)
cp .env.example .env

# 3. Launch the agent via PM2 (recommended in prod)
npm run pm2:start
pm2 save          # so PM2 restarts it on reboot

# Alternative: run directly without PM2 (less recommended in prod)
npm start
```

Check that the agent **stays** online (not `errored`):

```bash
pm2 ls
pm2 logs zenode-vm-host --lines 50 --nostream
```

If the job crashes with `Missing required environment variable CORE_API_URL`, the `.env` is missing or not read (PM2's working directory must be the repo root).

> ⚠️ The `.env` must be **at the repo root** and completed **before** `pm2 start`.

Useful PM2 scripts:

```bash
npm run pm2:stop     # stops the agent
npm run pm2:logs     # follows the agent logs
pm2 restart zenode-vm-host   # after editing the .env
```

### 2.3 "alone" mode (a single bot, no Core, no agent)

Purpose: test **one** bot locally, without the Core VM nor the host agent. Useful during development.

This mode reads the token and config directly from `.env` (section C variables), **not** from `configs/{bot_id}.json`.

```bash
# Compiles then runs the bot in alone mode
npm run start:alone

# Without recompiling (runs the already-built dist/)
npm run start:alone:wb
```

Prerequisites in alone mode (section C of `.env`):
- `BOT_TOKEN` → required.
- `PREFIX`, `BOT_NAME`, `BOT_STATUS`, `BOT_COLOR`, `MODULES` → optional.
- `OWNER_ID` → Discord admin IDs (dev commands).

In alone mode `--config` is ignored: to relaunch a bot from its config file, use `npm run start:bot -- --config configs/{bot_id}.json` instead.

---

## 3. Prerequisites

- Ubuntu (or another Linux) with **Node.js 18+** (20 recommended).
- **PM2** already installed (`pm2 -v`). No need to re-run `npm install -g pm2` if the command exists (on this VM it is in `/usr/bin/pm2`, installed as root → `EACCES` as user). Otherwise: `sudo npm install -g pm2`.
- Network access to the Core (`API_PORT` in prod = 3000).
- An `API_KEY` = `API_KEY_VM_BOTS_FREE` or `API_KEY_VM_BOTS_PREMIUM` from the Core.
- A **`.env` file at the repo root** (required before `pm2 start`).

Enable the **Privileged Gateway Intents** (Message Content, Server Members, Presence) on each Discord application. The template clearly logs intent errors (the Core dashboard parses those logs).

---

## 4. Installation

```bash
git clone https://github.com/ZenodeCie/Bot-V2.git
cd Bot-V2
npm install
cp .env.example .env    # then edit the .env
```

Edit `.env` (detailed steps are inside the file itself; everything is commented). Essential variables:

```env
CORE_API_URL=http://IP_OR_HOST:3000
CORE_WS_URL=ws://IP_OR_HOST:3000/ws    # optional, derived if absent
API_KEY=...
VM_HOST=vm-freebots-01
VM_TYPE=vm-bots-free
```

**Never commit** `.env` or `configs/*.json` (as `.gitignore` already does).

`MONGODB_URI` is **optional**. If set, all bot processes share the same database (`MONGODB_DB`, default `znd`) and isolate their documents through the `botId` field. The host agent does not connect to Mongo.

Old `znd_{bot_id}` databases can be merged once (bots stopped):

```bash
npm run migrate:mongo
```

---

## 5. Architecture

```text
src/
├── host/                 # VM agent (main process, PM2 name = zenode-vm-host)
│   ├── index.ts          # Boot, health, orphan cleanup, stats loops
│   ├── protocol.ts       # Typed WS/REST payloads (source of truth)
│   ├── wsClient.ts       # Core WS + 25s ping + exponential reconnect
│   ├── restClient.ts     # REST X-API-Key
│   ├── pm2Manager.ts     # start/stop/restart/delete/logs (execFile, never shell)
│   ├── handlers.ts       # bot_command, config_upload, bot_logs_request
│   └── reporter.ts       # POST /vms/stats + /real-status
├── bot/                  # Discord template (1 PM2 process per bot)
│   ├── index.ts          # --config, modules, heartbeat, graceful shutdown
│   ├── config.ts         # Token / prefix / color from JSON (not BOT_TOKEN .env)
│   ├── modules.ts        # Core keys → repo folders mapping
│   └── commands|events|utils
└── shared/               # bot_id, shape of the JSON config
```

Each bot = one PM2 fork, one token, one RAM cap (`--max-memory-restart`). No multiplexed discord.js client.

---

## 6. Host agent behaviour

At boot, the agent:

1. Checks Node 18+ and `pm2 -v`.
2. Opens the WebSocket: `{CORE_WS_URL}?apiKey={API_KEY}&vmHost={VM_HOST}`.
3. `GET /health` then `GET /api/v1/bots/vm/{VM_HOST}`.
4. Stops/deletes the PM2 "bot" processes **not assigned** to this VM (anti-duplicate).
5. Starts the stats loop (30 s) and real-status (gap ~120 s, max 6 POST/tick, 429 backoff).
6. Does **not** start all assigned bots (`AUTO_START_ASSIGNED=false` by default).

Core commands (`type: bot_command`):

| Action | Effect |
| --- | --- |
| `start` | Writes the config if provided, refuses if the bot already runs elsewhere (`GET /bots/:id`), `pm2 start`, WS `starting` then `online` (process up, **not** Discord ready) + REST `/status` (best-effort). |
| `stop` | `pm2 stop` + `delete`, idempotent, `offline`. |
| `restart` | Delete PM2 then start (fresh process, after a `config_upload`). |
| `delete` | `pm2 delete` + removes the local JSON. |

`config_upload`: writes `configs/{bot_id}.json` (chmod 600), does **not** start, replies `config_received`.

`bot_logs_request`: `pm2 logs` within 15 s, returns the `request_id` as-is.

Bots never appear in `ecosystem.config.cjs`: they are created by the agent:

```bash
pm2 start dist/bot/index.js --force --name "{pm2Name}" --max-memory-restart {max_memory}M -- --config "{abs}/configs/{bot_id}.json"
```

PM2 name = normalized `bot_id` (`bot00019` → `bot00019`).

Discord heartbeat: `data/{bot_id}/runtime.json` (every 5 s). File older than 30 s → `discord_ready=false`. The dashboard only shows "Online" when `really_online` arrives over REST.

---

## 7. Modules (core keys)

`Base` is always loaded. Other `config.modules` keys are mapped as follows:

| Core key | In this repo |
| --- | --- |
| `Base` | help, ping, prefix, `dev` commands, ready / messageCreate / interactionCreate events |
| `Utilities` | userinfo, emoji |
| `Moderation` | `commands/moderation` + `events/moderation` |
| `ModerationAvancee` | `commands/antiraid` + `events/antiraid` |
| Other core keys (Giveaway, Tickets, …) | no-op + warning, no crash |

---

## 8. Data & secrets

- `configs/`: JSON with **Discord tokens** — gitignored, folder `700`, files `600`.
- `data/{bot_id}/`: bot runtime + disk state, never shared between bots.
- `API_KEY` only as an environment variable.
- Optional HTTP health: `HOST_HEALTH_PORT=9100` → `127.0.0.1` only.

---

## 9. npm scripts

| Script | Action |
| --- | --- |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm run dev` | Compiles continuously (watch) |
| `npm start` | Runs the host agent (`dist/host/index.js`) |
| `npm run start:bot` | Template only (requires `--config`) |
| `npm run start:alone` | Compiles + runs a single bot (alone mode) |
| `npm run start:alone:wb` | Runs a single bot without recompiling (wb) |
| `npm run pm2:start` | `pm2 start ecosystem.config.cjs` |
| `npm run pm2:stop` | `pm2 stop zenode-vm-host` |
| `npm run pm2:logs` | `pm2 logs zenode-vm-host` |
| `npm run migrate:mongo` | Compiles + merges old mongo databases |

---

## 10. Manual tests

1. Agent up → the Core sees the VM (`getIndividualVMs` / infra staff).
2. POST stats → the VM shows up with 0 bots.
3. `config_upload` create → file written, `config_received`.
4. `bot_command start` → PM2 process, Discord ready, `really_online=true`.
5. `logs_request` → non-empty stdout.
6. `stop` → no more process, dashboard offline.
7. `restart` → new pid, config reloaded.
8. `delete` → no more process or file.
9. Cut the WS for 10 s → reconnect, stats, bots still up.
10. Second agent / another `VM_HOST`: a start on A does not appear on B.

---

## 11. Troubleshooting

| Symptom | Check |
| --- | --- |
| Agent exits at boot | `CORE_API_URL`, `CORE_WS_URL`, `API_KEY`, `VM_HOST` in the root `.env`. Restart: `pm2 restart zenode-vm-host` |
| `EACCES` on `npm install -g pm2` | PM2 is already installed as root. Use `pm2 -v`. Update: `sudo npm install -g pm2` |
| VM invisible to the Core | WS query `vmHost` + ping with `vm_host`; same host/port as the API |
| Bot PM2 up but dashboard "offline" | `data/{bot_id}/runtime.json` and POST `/real-status` (`really_online`) |
| Privileged Intents | Discord Portal → Bot → intents; `Privileged Intents error` logs |
| Duplicate bot_id | The Core sends `stop` everywhere; this VM refuses a start if `GET /bots/:id` shows another active VM |
| `429 Too Many Requests` flood | Normal if too many bots report too fast; the agent applies backoff and slows real-status. Check the Core rate limit is not too low for the number of bots |
| `pm2: command not found` | `sudo npm install -g pm2` |

---

## 12. Security

- Never version `.env` or `configs/*.json`.
- Revoke an exposed Discord token.
- Do not open public HTTP: the agent is a client of the Core.
