import { Schema, model, type InferSchemaType } from "mongoose"
import config from "../config.js"
import mongoClient from "./mongoClient.js"
import { applyBotScope, uniqueBotGuildIndex } from "./mongoScope.js"

const guildSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    prefix: { type: String, required: true, default: config.prefix },
  },
  { timestamps: true }
)

applyBotScope(guildSchema)
uniqueBotGuildIndex(guildSchema)

export type GuildData = InferSchemaType<typeof guildSchema>

export const Guild = model<GuildData>("Guild", guildSchema, "guilds")

const COLLECTIONS = [
  "guilds",
  "antiraid",
  "moderation_configs",
  "mod_cases",
  "mod_warnings",
  "mod_temp_sanctions",
  "mod_user_notes",
  "premium_config",
  "aeroport",
  "captcha",
  "giveaway",
  "giveaways",
  "logs",
  "levels",
  "levels_users",
  "informationpanel",
  "messagehoraire",
  "messagehoraires",
  "stafflist",
  "rules",
  "invitations",
  "invitations_users",
  "invitations_joins",
]

function isNamespaceExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === 48
}

export default async function initData() {
  const db = mongoClient.db
  if (!db) throw new Error("MongoDB connection is not established.")

  const existing = await db.listCollections().toArray()

  for (const name of COLLECTIONS) {
    if (existing.some((collection) => collection.name === name)) continue
    try {
      await db.createCollection(name)
      console.log(`Collection "${name}" created.`)
    } catch (error) {
      if (isNamespaceExists(error)) continue
      throw error
    }
  }
}
