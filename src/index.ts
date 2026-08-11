import { Client, Collection, GatewayIntentBits, Partials } from "discord.js"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import config from "./config.js"
import initData from "./utils/initData.js"
import { AntiRaidEngine } from "./utils/antiraid/engine.js"
import mongoClient, { connectMongo } from "./utils/mongoClient.js"

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Message],
})

client.prefix = config.prefix
client.commands = new Collection()
client.interactions = new Collection()
client.db = mongoClient
client.antiraid = new AntiRaidEngine(client)

client.once("ready", async () => {
  console.log(`Logged as ${client.user?.tag} & prefix for commands : ${config.prefix}`)
})

async function loadCommands(dir = join(import.meta.dirname, "commands")) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      await loadCommands(fullPath)
      continue
    }

    if (!entry.endsWith(".js")) continue
    const command = await import(pathToFileURL(fullPath).href)
    if (!command.default) continue
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
}

async function loadEvents(dir = join(import.meta.dirname, "events")) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      await loadEvents(fullPath)
      continue
    }

    if (!entry.endsWith(".js")) continue
    const { default: event } = await import(pathToFileURL(fullPath).href)
    if (!event) continue
    try {
      client.on(event.name, event.execute.bind(null, client))
      console.log(`Event ${event.name} loaded`)
    } catch (err) {
      console.log(`Failed to load event ${event.name}: ${err}`)
    }
  }
}

async function start() {
  await connectMongo()
  console.log("Connected to MongoDB.")
  await initData()
  await loadCommands()
  await loadEvents()
  await client.login(config.token)
}

start().catch((error) => {
  console.error("Fatal Error:", error)
  process.exit(1)
})
