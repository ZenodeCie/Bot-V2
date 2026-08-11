import { Schema, model } from "mongoose"

export type UsernameKind = "username" | "global_name" | "nickname"

export interface UsernameEntry {
  value: string
  kind: UsernameKind
  at: number
}

export interface UsernameHistoryDoc {
  scope: string
  userId: string
  entries: UsernameEntry[]
}

const usernameEntrySchema = new Schema<UsernameEntry>({
  value: { type: String, required: true },
  kind: { type: String, enum: ["username", "global_name", "nickname"], required: true },
  at: { type: Number, required: true },
})

const usernameHistorySchema = new Schema<UsernameHistoryDoc>({
  scope: { type: String, required: true },
  userId: { type: String, required: true },
  entries: { type: [usernameEntrySchema], default: [] },
})

usernameHistorySchema.index({ scope: 1, userId: 1 }, { unique: true })

export const UsernameHistory = model<UsernameHistoryDoc>(
  "UsernameHistory",
  usernameHistorySchema,
  "username_history"
)

export const HISTORY_LIMIT = 50

export async function recordUsername(
  scope: string,
  userId: string,
  value: string,
  kind: UsernameKind,
  at = Date.now()
): Promise<void> {
  if (!value) return
  const doc = await UsernameHistory.findOne({ scope, userId }).lean()
  const last = doc?.entries[doc.entries.length - 1]
  if (last && last.value === value && last.kind === kind) return
  await UsernameHistory.updateOne(
    { scope, userId },
    {
      $push: {
        entries: {
          $each: [{ value, kind, at }],
          $slice: -HISTORY_LIMIT,
        },
      },
    },
    { upsert: true }
  )
}

export async function getUsernameHistory(guildId: string, userId: string): Promise<UsernameEntry[]> {
  const [globalDoc, guildDoc] = await Promise.all([
    UsernameHistory.findOne({ scope: "global", userId }).lean(),
    UsernameHistory.findOne({ scope: guildId, userId }).lean(),
  ])
  return [...(globalDoc?.entries ?? []), ...(guildDoc?.entries ?? [])].sort((a, b) => a.at - b.at)
}