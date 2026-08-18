import { Schema, model } from "mongoose"

export const EVENT_KEYS = [
  "messages",
  "members",
  "moderation",
  "voice",
  "channels",
  "roles",
  "server",
  "invites",
  "threads",
] as const

export type EventKey = (typeof EVENT_KEYS)[number]

export const EVENT_LABELS: Record<EventKey, string> = {
  messages: "Messages",
  members: "Membres",
  moderation: "Modération",
  voice: "Vocal",
  channels: "Salons",
  roles: "Rôles",
  server: "Serveur",
  invites: "Invitations",
  threads: "Fils",
}

export const EVENT_HINTS: Record<EventKey, string> = {
  messages: "Suppressions, éditions, suppressions en masse",
  members: "Arrivées, départs, pseudo, rôles",
  moderation: "Expulsions, bans, timeouts",
  voice: "Join, leave, move, mute",
  channels: "Création, suppression, modification",
  roles: "Création, suppression, modification",
  server: "Paramètres, emojis, boosts",
  invites: "Création et suppression",
  threads: "Création, suppression, modification",
}

export type EventFlags = Record<EventKey, boolean>

export interface LogsConfig {
  guildId: string
  enabled: boolean
  channelId: string | null
  ignoreBots: boolean
  ignoredChannels: string[]
  events: EventFlags
}

function allEvents(enabled: boolean): EventFlags {
  return Object.fromEntries(EVENT_KEYS.map((key) => [key, enabled])) as EventFlags
}

export function defaultConfig(guildId: string): LogsConfig {
  return {
    guildId,
    enabled: false,
    channelId: null,
    ignoreBots: true,
    ignoredChannels: [],
    events: allEvents(true),
  }
}

const logsSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    ignoreBots: { type: Boolean, default: true },
    ignoredChannels: { type: [String], default: [] },
    events: {
      messages: { type: Boolean, default: true },
      members: { type: Boolean, default: true },
      moderation: { type: Boolean, default: true },
      voice: { type: Boolean, default: true },
      channels: { type: Boolean, default: true },
      roles: { type: Boolean, default: true },
      server: { type: Boolean, default: true },
      invites: { type: Boolean, default: true },
      threads: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
)

export const Logs = model("Logs", logsSchema, "logs")

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asStringOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  return typeof value === "string" ? value : fallback
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const ids = value.filter((item): item is string => typeof item === "string" && /^\d{17,20}$/.test(item))
  return [...new Set(ids)].slice(0, 25)
}

function normalizeEvents(raw: unknown, fallback: EventFlags): EventFlags {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const events = { ...fallback }
  for (const key of EVENT_KEYS) {
    events[key] = asBoolean(source[key], fallback[key])
  }
  return events
}

export function parseEventKey(raw: string | undefined): EventKey | "all" | null {
  if (!raw) return null
  const value = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
  if (["all", "tous", "tout", "*"].includes(value)) return "all"
  const aliases: Record<string, EventKey> = {
    messages: "messages",
    message: "messages",
    membres: "members",
    members: "members",
    member: "members",
    moderation: "moderation",
    modo: "moderation",
    vocal: "voice",
    voice: "voice",
    voc: "voice",
    salons: "channels",
    channels: "channels",
    channel: "channels",
    salon: "channels",
    roles: "roles",
    role: "roles",
    serveur: "server",
    server: "server",
    guild: "server",
    invites: "invites",
    invite: "invites",
    invitations: "invites",
    invitation: "invites",
    threads: "threads",
    thread: "threads",
    fils: "threads",
  }
  return aliases[value] ?? (EVENT_KEYS.includes(value as EventKey) ? (value as EventKey) : null)
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): LogsConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  return {
    guildId,
    enabled: asBoolean(raw?.enabled, defaults.enabled),
    channelId: asStringOrNull(raw?.channelId, defaults.channelId),
    ignoreBots: asBoolean(raw?.ignoreBots, defaults.ignoreBots),
    ignoredChannels: asStringArray(raw?.ignoredChannels, defaults.ignoredChannels),
    events: normalizeEvents(raw?.events, defaults.events),
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: LogsConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<LogsConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await Logs.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<LogsConfig> {
  await Logs.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}
