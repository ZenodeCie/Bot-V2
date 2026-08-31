import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import {
  ActivityType,
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
} from "discord.js"
import config, { botRuntime, colors, startApplicationEmojiWatcher } from "./config.js"
import { filesForModules, resolveEnabledModules } from "./modules.js"
import {
  snapshotFromClient,
  startHeartbeat,
  writeRuntimeFile,
} from "./runtimeHeartbeat.js"
import initData from "./utils/initData.js"
import { AntiRaidEngine } from "./utils/antiraid/engine.js"
import mongoClient, { connectMongo, mongoDbName } from "./utils/mongoClient.js"
import type { Command, InteractionHandler } from "./types.js"

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildEmojisAndStickers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
})

const { enabled: enabledModules, unknown: unknownModules } = resolveEnabledModules(botRuntime.modules)

client.prefix = config.prefix
client.commands = new Collection<string, Command>()
client.interactions = new Collection<string, InteractionHandler>()
client.db = mongoClient
client.antiraid = new AntiRaidEngine(client)
client.botId = botRuntime.botId
client.dataDir = botRuntime.dataDir
client.enabledModules = enabledModules

client.on('debug', console.log)
      .on('warn', console.log)

let stopHeartbeat: (() => void) | undefined
let stopEmojiWatcher: (() => void) | undefined
let shuttingDown = false

function applyPresence(): void {
  if (!client.user) return
  void client.user.setPresence({
    activities: [{ name: botRuntime.status, type: ActivityType.Playing }],
    status: "online",
  })
}

function logPrivilegedIntents(error: unknown): void {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const lower = text.toLowerCase()
  if (lower.includes("disallowed intents") || lower.includes("privileged") || lower.includes("used disallowed intents")) {
    console.error(
      `Privileged Intents error (unauthorized gateway identify): ${text}. Enable Message Content, Server Members Intent and Presence Intent in the Discord Developer Portal.`
    )
    return
  }
  if (lower.includes("invalid token") || lower.includes("an invalid token") || lower.includes("unauthorized")) {
    console.error(`Invalid Discord token (unauthorized): ${text}`)
    return
  }
  console.error(text)
}

async function loadCommandFile(fullPath: string): Promise<void> {
  if (!existsSync(fullPath)) {
    console.warn(`Command file missing: ${fullPath}`)
    return
  }
  const command = await import(pathToFileURL(fullPath).href) as {
    default?: Command
    handleInteraction?: InteractionHandler
  }
  if (!command.default?.name) return
  try {
    client.commands.set(command.default.name, command.default)
    console.log(`Command ${command.default.name} loaded`)
    const interactionHandler =
      typeof command.default.handleInteraction === "function"
        ? command.default.handleInteraction
        : typeof command.handleInteraction === "function"
          ? command.handleInteraction
          : null
    if (interactionHandler) {
      client.interactions.set(command.default.name, interactionHandler)
    }
  } catch (err) {
    console.log(`Failed to load command ${command.default.name}: ${err}`)
  }
}

async function loadEventFile(fullPath: string): Promise<void> {
  if (!existsSync(fullPath)) {
    console.warn(`Event file missing: ${fullPath}`)
    return
  }
  const mod = await import(pathToFileURL(fullPath).href) as {
    default?: { name: string; execute: (bot: Client, ...args: unknown[]) => unknown }
  }
  const event = mod.default
  if (!event?.name) return
  try {
    client.on(event.name as never, event.execute.bind(null, client) as never)
    console.log(`Event ${event.name} loaded`)
  } catch (err) {
    console.log(`Failed to load event ${event.name}: ${err}`)
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag} — bot prêt / connecté (${botRuntime.botId})`)
  console.log(`Prefix for commands : ${config.prefix}`)
  applyPresence()
  await writeRuntimeFile(botRuntime.dataDir, snapshotFromClient(client, true))
})

client.on("shardDisconnect", () => {
  console.warn("Discord shard disconnected")
  void writeRuntimeFile(botRuntime.dataDir, snapshotFromClient(client, false))
})

client.on("shardReconnecting", () => {
  console.log("Discord reconnecting...")
  void writeRuntimeFile(botRuntime.dataDir, snapshotFromClient(client, false))
})

client.on("shardResume", () => {
  console.log("Discord connection resumed — ready")
  applyPresence()
  void writeRuntimeFile(botRuntime.dataDir, snapshotFromClient(client, true))
})

client.on("error", (error) => {
  logPrivilegedIntents(error)
})

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}, shutting down gracefully`)
  stopHeartbeat?.()
  stopEmojiWatcher?.()
  try {
    await writeRuntimeFile(botRuntime.dataDir, snapshotFromClient(client, false))
  } catch {
    /* best-effort */
  }
  try {
    client.destroy()
  } catch {
    /* already destroyed */
  }
  try {
    if (mongoClient.readyState === 1) await mongoClient.close()
  } catch {
    /* not connected */
  }
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown("SIGINT")
})
process.on("SIGTERM", () => {
  void shutdown("SIGTERM")
})

async function start(): Promise<void> {
  await mkdir(botRuntime.dataDir, { recursive: true })
  await writeRuntimeFile(botRuntime.dataDir, {
    ready: false,
    readyState: "CONNECTING",
    ping: 0,
    guilds: 0,
    users: 0,
    updatedAt: Date.now(),
  })

  console.log(
    `Starting bot ${botRuntime.botId} (${botRuntime.name}) modules=[${[...enabledModules].join(", ")}] color=${colors.prime}`
  )
  for (const name of unknownModules) {
    console.warn(`Unknown module "${name}" — ignored (no-op)`)
  }

  const mongoOk = await connectMongo()
  if (mongoOk) {
    console.log(`Connected to MongoDB (shared db ${mongoDbName()}, scoped by botId ${botRuntime.botId}).`)
    await initData()
  } else {
    console.warn("MongoDB skipped — guild-specific persistence disabled.")
  }

  const files = filesForModules(import.meta.dirname, enabledModules)
  for (const file of files.commands) await loadCommandFile(file)
  for (const file of files.events) await loadEventFile(file)

  stopHeartbeat = startHeartbeat(client, botRuntime.dataDir)
  stopEmojiWatcher = startApplicationEmojiWatcher()

  try {
    await client.login(config.token)
  } catch (error) {
    logPrivilegedIntents(error)
    await writeRuntimeFile(botRuntime.dataDir, {
      ready: false,
      readyState: "UNKNOWN",
      ping: 0,
      guilds: 0,
      users: 0,
      updatedAt: Date.now(),
    })
    console.error("Discord login failed — process stays alive for the host agent (no PM2 restart spam).")
  }
}

start().catch((error: unknown) => {
  console.error("Fatal Error:", error)
  logPrivilegedIntents(error)
})
