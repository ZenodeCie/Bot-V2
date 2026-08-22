import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { config as loadDotenv } from "dotenv"
import mongoose from "mongoose"

loadDotenv()
const configEnv = resolve(process.cwd(), "config.env")
if (existsSync(configEnv)) loadDotenv({ path: configEnv, override: false })

function mongoDbName(): string {
  const raw = (process.env.MONGODB_DB ?? "znd").trim()
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
  return cleaned || "znd"
}

function stampDoc(
  doc: Record<string, unknown>,
  botId: string,
  collection: string
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...doc }
  if (next.botId == null) next.botId = botId
  if (collection === "premium_config" && (next._id === "global" || next._id == null)) {
    next._id = typeof next.botId === "string" ? next.botId : botId
  }
  return next
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim()
  if (!uri) {
    console.error("Missing MONGODB_URI")
    process.exit(1)
  }

  const targetName = mongoDbName()
  await mongoose.connect(uri)
  const client = mongoose.connection.getClient()
  const { databases } = await client.db().admin().listDatabases()
  const sources = databases
    .map((entry) => entry.name)
    .filter((name) => name.startsWith("znd_") && name !== targetName)
    .sort()

  if (sources.length === 0) {
    console.log(`No source databases matching znd_* (excluding ${targetName}).`)
    await mongoose.disconnect()
    return
  }

  const dest = client.db(targetName)
  console.log(`Target shared database: ${targetName}`)
  console.log(`Sources: ${sources.join(", ")}`)

  for (const dbName of sources) {
    const botId = dbName.slice("znd_".length)
    console.log(`Migrating ${dbName} → ${targetName} (botId=${botId})`)
    const src = client.db(dbName)
    const collections = await src.listCollections().toArray()
    for (const { name } of collections) {
      if (name.startsWith("system.")) continue
      const docs = await src.collection(name).find({}).toArray()
      if (docs.length === 0) {
        console.log(`  ${name}: empty`)
        continue
      }
      const stamped = docs.map((doc) => stampDoc({ ...doc } as Record<string, unknown>, botId, name))
      const result = await dest.collection(name).bulkWrite(
        stamped.map((doc) => {
          const { _id, ...rest } = doc
          return {
            updateOne: {
              filter: { _id },
              update: { $setOnInsert: rest },
              upsert: true,
            },
          }
        }) as never,
        { ordered: false }
      )
      console.log(`  ${name}: upserted=${result.upsertedCount} alreadyPresent=${result.matchedCount}`)
    }
  }

  await mongoose.disconnect()
  console.log("Done. Old znd_* databases were left in place for rollback.")
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
