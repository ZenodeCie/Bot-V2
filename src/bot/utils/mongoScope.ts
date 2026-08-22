import { Schema, type Query } from "mongoose"
import config from "../config.js"

const QUERY_METHODS = [
  "countDocuments",
  "deleteMany",
  "deleteOne",
  "find",
  "findOne",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateMany",
  "updateOne",
] as const

function injectBotId(this: Query<unknown, unknown>): void {
  const filter = this.getFilter() as Record<string, unknown>
  if (filter.botId == null) {
    this.setQuery({ ...filter, botId: config.botId })
  }
}

export function applyBotScope(schema: Schema): void {
  schema.add({
    botId: { type: String, required: true, index: true, default: () => config.botId },
  })

  for (const method of QUERY_METHODS) {
    schema.pre(method, injectBotId)
  }

  schema.pre("save", function () {
    if (!this.get("botId")) this.set("botId", config.botId)
  })

  schema.pre("insertMany", function (docs: unknown) {
    const list = Array.isArray(docs) ? docs : [docs]
    for (const doc of list) {
      if (!doc || typeof doc !== "object") continue
      const record = doc as Record<string, unknown>
      if (record.botId == null) record.botId = config.botId
    }
  })
}

export function uniqueBotGuildIndex(schema: Schema): void {
  schema.index({ botId: 1, guildId: 1 }, { unique: true })
}

export function uniqueBotGuildUserIndex(schema: Schema): void {
  schema.index({ botId: 1, guildId: 1, userId: 1 }, { unique: true })
}
