import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildUserIndex } from "../mongoScope.js"

export interface UserNoteDoc {
  guildId: string
  userId: string
  content: string
  authorId: string
  authorName: string
  lastEditorId: string
  lastEditorName: string
  createdAt: number
  updatedAt: number
}

const userNoteSchema = new Schema<UserNoteDoc>(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    content: { type: String, required: true },
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    lastEditorId: { type: String, required: true },
    lastEditorName: { type: String, required: true },
    createdAt: { type: Number, required: true },
    updatedAt: { type: Number, required: true },
  }
)

applyBotScope(userNoteSchema)
uniqueBotGuildUserIndex(userNoteSchema)

export const UserNote = model<UserNoteDoc>("UserNote", userNoteSchema, "mod_user_notes")

export async function getUserNote(guildId: string, userId: string): Promise<UserNoteDoc | null> {
  return (await UserNote.findOne({ guildId, userId }).lean()) as unknown as UserNoteDoc | null
}

export async function setUserNote(
  guildId: string,
  userId: string,
  content: string,
  editorId: string,
  editorName: string
): Promise<UserNoteDoc> {
  const now = Date.now()
  const doc = await UserNote.findOneAndUpdate(
    { guildId, userId },
    {
      $set: {
        content,
        lastEditorId: editorId,
        lastEditorName: editorName,
        updatedAt: now,
      },
      $setOnInsert: {
        authorId: editorId,
        authorName: editorName,
        createdAt: now,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()
  return doc as unknown as UserNoteDoc
}
