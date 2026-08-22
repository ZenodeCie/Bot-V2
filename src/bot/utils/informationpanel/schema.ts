import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"

export const FIELD_KEYS = ["members", "online", "boosts", "owner", "created", "channels", "roles"] as const
export type FieldKey = (typeof FIELD_KEYS)[number]

export const FIELD_LABELS: Record<FieldKey, string> = {
  members: "Membres",
  online: "En ligne",
  boosts: "Boosts",
  owner: "Fondateur",
  created: "Création",
  channels: "Salons",
  roles: "Rôles",
}

export const MIN_INTERVAL = 60 * 1000
export const MAX_INTERVAL = 24 * 60 * 60 * 1000
export const DEFAULT_INTERVAL = 5 * 60 * 1000
export const MAX_TITLE_LENGTH = 256
export const MAX_DESCRIPTION_LENGTH = 1000

export type FieldFlags = Record<FieldKey, boolean>

export interface InformationPanelConfig {
  guildId: string
  enabled: boolean
  channelId: string | null
  messageId: string | null
  title: string
  description: string
  interval: number
  nextAt: number | null
  fields: FieldFlags
}

function defaultFields(): FieldFlags {
  return {
    members: true,
    online: false,
    boosts: true,
    owner: true,
    created: true,
    channels: false,
    roles: false,
  }
}

export function defaultConfig(guildId: string): InformationPanelConfig {
  return {
    guildId,
    enabled: false,
    channelId: null,
    messageId: null,
    title: "",
    description: "",
    interval: DEFAULT_INTERVAL,
    nextAt: null,
    fields: defaultFields(),
  }
}

const fieldsSchema = new Schema(
  {
    members: { type: Boolean, default: true },
    online: { type: Boolean, default: false },
    boosts: { type: Boolean, default: true },
    owner: { type: Boolean, default: true },
    created: { type: Boolean, default: true },
    channels: { type: Boolean, default: false },
    roles: { type: Boolean, default: false },
  },
  { _id: false }
)

const informationPanelSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    interval: { type: Number, default: DEFAULT_INTERVAL },
    nextAt: { type: Number, default: null },
    fields: { type: fieldsSchema, default: () => defaultFields() },
  },
  { timestamps: true }
)

applyBotScope(informationPanelSchema)
uniqueBotGuildIndex(informationPanelSchema)

export const InformationPanel = model("InformationPanel", informationPanelSchema, "informationpanel")

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function asStringOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function clampInterval(ms: number): number {
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(ms)))
}

export function clampTitle(value: string): string {
  return value.trim().slice(0, MAX_TITLE_LENGTH)
}

export function clampDescription(value: string): string {
  return value.trim().slice(0, MAX_DESCRIPTION_LENGTH)
}

export function isFieldKey(value: string): value is FieldKey {
  return FIELD_KEYS.includes(value as FieldKey)
}

function normalizeFields(raw: Record<string, unknown> | null | undefined): FieldFlags {
  const defaults = defaultFields()
  const value = raw ?? {}
  return {
    members: asBoolean(value.members, defaults.members),
    online: asBoolean(value.online, defaults.online),
    boosts: asBoolean(value.boosts, defaults.boosts),
    owner: asBoolean(value.owner, defaults.owner),
    created: asBoolean(value.created, defaults.created),
    channels: asBoolean(value.channels, defaults.channels),
    roles: asBoolean(value.roles, defaults.roles),
  }
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): InformationPanelConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  const interval = clampInterval(asNumber(raw?.interval, defaults.interval))
  const nextAtRaw = raw?.nextAt
  return {
    guildId,
    enabled: asBoolean(raw?.enabled, defaults.enabled),
    channelId: asStringOrNull(raw?.channelId, defaults.channelId),
    messageId: asStringOrNull(raw?.messageId, defaults.messageId),
    title: clampTitle(asString(raw?.title, defaults.title)),
    description: clampDescription(asString(raw?.description, defaults.description)),
    interval: interval > 0 ? interval : defaults.interval,
    nextAt: typeof nextAtRaw === "number" && Number.isFinite(nextAtRaw) ? nextAtRaw : null,
    fields: normalizeFields(raw?.fields as Record<string, unknown> | undefined),
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: InformationPanelConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<InformationPanelConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await InformationPanel.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<InformationPanelConfig> {
  await InformationPanel.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export async function listEnabledPanels(): Promise<InformationPanelConfig[]> {
  const docs = await InformationPanel.find({ enabled: true, channelId: { $ne: null } }).lean()
  return docs.map((doc) => normalizeConfig(doc as Record<string, unknown>))
}

export async function listDuePanels(): Promise<InformationPanelConfig[]> {
  const now = Date.now()
  const docs = await InformationPanel.find({
    enabled: true,
    channelId: { $ne: null },
    $or: [{ nextAt: null }, { nextAt: { $lte: now } }],
  }).lean()
  return docs.map((doc) => normalizeConfig(doc as Record<string, unknown>))
}
