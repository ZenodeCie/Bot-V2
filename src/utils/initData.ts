import { Schema, model, type InferSchemaType } from "mongoose"
import config from "../config.js"
import mongoClient from "./mongoClient.js"

const guildSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    prefix: { type: String, required: true, default: config.prefix },
  },
  { timestamps: true }
)

export type GuildData = InferSchemaType<typeof guildSchema>

export const Guild = model<GuildData>("Guild", guildSchema, "guilds")

const COLLECTIONS = ["guilds"]

export default async function initData() {
  const db = mongoClient.db
  if (!db) throw new Error("MongoDB connection is not established.")

  const existing = await db.listCollections().toArray()

  for (const name of COLLECTIONS) {
    if (existing.some((collection) => collection.name === name)) continue
    await db.createCollection(name)
    console.log(`Collection "${name}" created.`)
  }
}
