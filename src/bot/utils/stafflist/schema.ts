import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"

export const MAX_TITLE_LENGTH = 256
export const MAX_DESCRIPTION_LENGTH = 1000
export const MAX_ROLES = 25

export interface StaffListConfig {
  guildId: string
  enabled: boolean
  channelId: string | null
  messageId: string | null
  title: string
  description: string
  roleIds: string[]
  showStatus: boolean
  ignoreBots: boolean
}

export function defaultConfig(guildId: string): StaffListConfig {
  return {
    guildId,
    enabled: false,
    channelId: null,
    messageId: null,
    title: "",
    description: "",
    roleIds: [],
    showStatus: true,
    ignoreBots: true,
  }
}

const staffListSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    roleIds: { type: [String], default: [] },
    showStatus: { type: Boolean, default: true },
    ignoreBots: { type: Boolean, default: true },
  },
  { timestamps: true }
)

applyBotScope(staffListSchema)
uniqueBotGuildIndex(staffListSchema)

export const StaffList = model("StaffList", staffListSchema, "stafflist")

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

function normalizeRoleIds(value: unknown): string[] {
  const ids = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && /^\d{17,20}$/.test(entry))
    : []
  const unique: string[] = []
  for (const id of ids) {
    if (unique.includes(id)) continue
    unique.push(id)
    if (unique.length >= MAX_ROLES) break
  }
  return unique
}

export function clampTitle(value: string): string {
  return value.trim().slice(0, MAX_TITLE_LENGTH)
}

export function clampDescription(value: string): string {
  return value.trim().slice(0, MAX_DESCRIPTION_LENGTH)
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): StaffListConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  return {
    guildId,
    enabled: asBoolean(raw?.enabled, defaults.enabled),
    channelId: asStringOrNull(raw?.channelId, defaults.channelId),
    messageId: asStringOrNull(raw?.messageId, defaults.messageId),
    title: clampTitle(asString(raw?.title, defaults.title)),
    description: clampDescription(asString(raw?.description, defaults.description)),
    roleIds: normalizeRoleIds(raw?.roleIds),
    showStatus: asBoolean(raw?.showStatus, defaults.showStatus),
    ignoreBots: asBoolean(raw?.ignoreBots, defaults.ignoreBots),
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: StaffListConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<StaffListConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await StaffList.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<StaffListConfig> {
  await StaffList.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export async function listEnabledLists(): Promise<StaffListConfig[]> {
  const docs = await StaffList.find({ enabled: true, channelId: { $ne: null } }).lean()
  return docs.map((doc) => normalizeConfig(doc as Record<string, unknown>))
}
