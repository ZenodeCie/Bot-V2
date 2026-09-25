import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import config from "../../config.js"
import mongoClient from "../mongoClient.js"
import {
  ReminderModel,
  RemindersConfigModel,
  normalizeOverride,
  normalizeRecord,
  type ReminderRecord,
  type RemindersSettingsOverride,
} from "./schema.js"

/**
 * Stockage du module Rappels.
 * Mongo (base partagée, scopée botId) si la connexion est établie, sinon un
 * fichier JSON `data/{bot_id}/reminders.json` (mode alone sans Mongo).
 */

export interface RemindersStore {
  kind: "mongo" | "file"
  listAll(): Promise<ReminderRecord[]>
  listForUser(guildId: string, userId: string): Promise<ReminderRecord[]>
  get(guildId: string, id: string): Promise<ReminderRecord | null>
  save(record: ReminderRecord): Promise<void>
  remove(guildId: string, id: string): Promise<void>
  countForUser(guildId: string, userId: string): Promise<number>
  removeGuild(guildId: string): Promise<void>
  getGuildOverride(guildId: string): Promise<RemindersSettingsOverride>
  saveGuildOverride(guildId: string, override: RemindersSettingsOverride): Promise<void>
}

let store: RemindersStore | undefined

export function remindersStore(): RemindersStore {
  if (!store) {
    store = mongoClient.readyState === 1 ? new MongoRemindersStore() : new FileRemindersStore()
    console.log(`[Rappels] Stockage ${store.kind} actif (botId=${config.botId}).`)
  }
  return store
}

export function resetRemindersStore(): void {
  store = undefined
}

const REMINDER_PROJECTION = "-_id -__v -botId"

// ---------------------------------------------------------------------------
// Backend Mongo
// ---------------------------------------------------------------------------

class MongoRemindersStore implements RemindersStore {
  readonly kind = "mongo" as const

  async listAll(): Promise<ReminderRecord[]> {
    const docs = await ReminderModel.find({}).select(REMINDER_PROJECTION).lean()
    return docs
      .map((doc) => normalizeRecord(doc as Record<string, unknown>))
      .filter((record): record is ReminderRecord => record !== null)
  }

  async listForUser(guildId: string, userId: string): Promise<ReminderRecord[]> {
    const docs = await ReminderModel.find({ guildId, authorId: userId }).select(REMINDER_PROJECTION).lean()
    return docs
      .map((doc) => normalizeRecord(doc as Record<string, unknown>))
      .filter((record): record is ReminderRecord => record !== null)
  }

  async get(guildId: string, id: string): Promise<ReminderRecord | null> {
    const doc = await ReminderModel.findOne({ guildId, _id: id }).select(REMINDER_PROJECTION).lean()
    return normalizeRecord(doc as Record<string, unknown> | null)
  }

  async save(record: ReminderRecord): Promise<void> {
    const { id, createdAt, ...rest } = record
    await ReminderModel.updateOne(
      { _id: id },
      { $set: { ...rest, createdAt: new Date(createdAt) } },
      { upsert: true }
    )
  }

  async remove(guildId: string, id: string): Promise<void> {
    await ReminderModel.deleteOne({ guildId, _id: id })
  }

  async countForUser(guildId: string, userId: string): Promise<number> {
    return ReminderModel.countDocuments({ guildId, authorId: userId })
  }

  async removeGuild(guildId: string): Promise<void> {
    await ReminderModel.deleteMany({ guildId })
  }

  async getGuildOverride(guildId: string): Promise<RemindersSettingsOverride> {
    const doc = await RemindersConfigModel.findOne({ guildId }).select("-_id -__v -botId").lean()
    return normalizeOverride(doc as Record<string, unknown> | null)
  }

  async saveGuildOverride(guildId: string, override: RemindersSettingsOverride): Promise<void> {
    await RemindersConfigModel.findOneAndUpdate(
      { guildId },
      {
        $set: {
          adminOnly: override.adminOnly ?? null,
          maxRemindersPerUser: override.maxRemindersPerUser ?? null,
          allowWebhookDestination: override.allowWebhookDestination ?? null,
        },
      },
      { upsert: true }
    )
  }
}

// ---------------------------------------------------------------------------
// Backend fichiers (fallback sans Mongo)
// ---------------------------------------------------------------------------

const STORE_PATH = join(config.dataDir, "reminders.json")
const FORMAT_VERSION = 1

interface FileEnvelope {
  version: number
  overrides: Record<string, RemindersSettingsOverride>
  reminders: ReminderRecord[]
}

interface FileLockEntry {
  previous: Promise<unknown>
}

const locks = new Map<string, FileLockEntry>()

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = locks.get(key) ?? { previous: Promise.resolve() }
  const run = entry.previous.then(() => fn(), () => fn())
  const slot = run.catch(() => undefined)
  locks.set(key, { previous: slot })
  void slot.finally(() => {
    if (locks.get(key)?.previous === slot) locks.delete(key)
  })
  return run
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 })
  await rename(tmp, path).catch(async (error: unknown) => {
    await writeFile(path, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 })
    throw error
  })
}

function emptyEnvelope(): FileEnvelope {
  return { version: FORMAT_VERSION, overrides: {}, reminders: [] }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

async function readEnvelope(): Promise<FileEnvelope> {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(await readFile(STORE_PATH, "utf8"))
  } catch {
    return emptyEnvelope()
  }
  const raw = asRecord(parsed)
  if (!raw) return emptyEnvelope()

  const envelope = emptyEnvelope()
  const overrides = asRecord(raw.overrides)
  if (overrides) {
    for (const [guildId, value] of Object.entries(overrides)) {
      const record = asRecord(value)
      if (record) envelope.overrides[guildId] = normalizeOverride(record)
    }
  }
  if (Array.isArray(raw.reminders)) {
    for (const item of raw.reminders) {
      const record = asRecord(item)
      const normalized = normalizeRecord(record)
      if (normalized) envelope.reminders.push(normalized)
    }
  }
  return envelope
}

async function writeEnvelope(envelope: FileEnvelope): Promise<void> {
  await writeJsonAtomic(STORE_PATH, envelope)
}

function sortByNextAt(records: ReminderRecord[]): ReminderRecord[] {
  return records.sort((a, b) => a.nextAt - b.nextAt)
}

class FileRemindersStore implements RemindersStore {
  readonly kind = "file" as const

  async listAll(): Promise<ReminderRecord[]> {
    return withLock("reminders", async () => sortByNextAt((await readEnvelope()).reminders))
  }

  async listForUser(guildId: string, userId: string): Promise<ReminderRecord[]> {
    return withLock("reminders", async () =>
      sortByNextAt((await readEnvelope()).reminders.filter((r) => r.guildId === guildId && r.authorId === userId))
    )
  }

  async get(guildId: string, id: string): Promise<ReminderRecord | null> {
    return withLock("reminders", async () => {
      const found = (await readEnvelope()).reminders.find((r) => r.guildId === guildId && r.id === id)
      return found ?? null
    })
  }

  async save(record: ReminderRecord): Promise<void> {
    await withLock("reminders", async () => {
      const envelope = await readEnvelope()
      const index = envelope.reminders.findIndex((r) => r.guildId === record.guildId && r.id === record.id)
      if (index === -1) envelope.reminders.push(record)
      else envelope.reminders[index] = record
      await writeEnvelope(envelope)
    })
  }

  async remove(guildId: string, id: string): Promise<void> {
    await withLock("reminders", async () => {
      const envelope = await readEnvelope()
      envelope.reminders = envelope.reminders.filter((r) => !(r.guildId === guildId && r.id === id))
      await writeEnvelope(envelope)
    })
  }

  async countForUser(guildId: string, userId: string): Promise<number> {
    return withLock("reminders", async () => {
      const envelope = await readEnvelope()
      return envelope.reminders.filter((r) => r.guildId === guildId && r.authorId === userId).length
    })
  }

  async removeGuild(guildId: string): Promise<void> {
    await withLock("reminders", async () => {
      const envelope = await readEnvelope()
      envelope.reminders = envelope.reminders.filter((r) => r.guildId !== guildId)
      delete envelope.overrides[guildId]
      await writeEnvelope(envelope)
    })
  }

  async getGuildOverride(guildId: string): Promise<RemindersSettingsOverride> {
    return withLock("reminders", async () => (await readEnvelope()).overrides[guildId] ?? {})
  }

  async saveGuildOverride(guildId: string, override: RemindersSettingsOverride): Promise<void> {
    await withLock("reminders", async () => {
      const envelope = await readEnvelope()
      envelope.overrides[guildId] = override
      await writeEnvelope(envelope)
    })
  }
}
