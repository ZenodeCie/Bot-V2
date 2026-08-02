import { Client, Collection, GatewayIntentBits, Partials } from "discord.js"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import config from "./config.js"
import mongoClient, { connectMongo } from "./utils/mongoClient.js"

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message],
})

client.prefix = config.prefix
client.commands = new Collection()
client.db = mongoClient

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
    const command = await import(fullPath)
    client.commands.set(command.default.name, command.default)
  }
}

async function loadEvents() {
  const files = readdirSync(join(import.meta.dirname, "events"))
  for (const file of files) {
    if (!file.endsWith(".js")) continue
    const { default: event } = await import(`./events/${file}`)
    client.on(event.name, event.execute.bind(null, client))
  }
}

async function start() {
  await connectMongo()
  console.log("Connected to MongoDB.")
  await loadCommands()
  await loadEvents()
  await client.login(config.token)
}

start().catch((error) => {
  console.error("Fatal Error:", error)
  process.exit(1)
})
