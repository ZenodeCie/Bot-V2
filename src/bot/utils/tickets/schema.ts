import { Schema, model } from "mongoose"

export const MAX_CATEGORIES = 25
export const MAX_CHANNEL_NAME_LENGTH = 90
export const MAX_OPEN_TEXT_LENGTH = 2000
export const MAX_PATTERN_LENGTH = 90

export type TicketPanelType = "button" | "select"

export interface TicketCategory {
  id: string
  categoryId: string | null
  emoji: string
  channelNamePattern: string
  openText: string
  openEmbed: TicketEmbedConfig
  staffRoleIds: string[]
  mentionRoleIds: string[]
}

export interface TicketEmbedConfig {
  title: string
  description: string
  color: string | null
  imageUrl: string | null
  thumbnailUrl: string | null
  footer: string
}

export function emptyEmbed(): TicketEmbedConfig {
  return {
    title: "",
    description: "",
    color: null,
    imageUrl: null,
    thumbnailUrl: null,
    footer: "",
  }
}

export interface TicketsConfig {
  guildId: string
  type: TicketPanelType
  claimEnabled: boolean
  requiredRoleIds: string[]
  blacklistRoleIds: string[]
  logsChannelId: string | null
  embed: TicketEmbedConfig
  categories: TicketCategory[]
  panelChannelId: string | null
  panelMessageId: string | null
  counter: number
}

export interface TicketRecordModel {
  guildId: string
  channelId: string
  userId: string
  categoryId: string
  number: number
  claimedBy: string | null
  closedAt: number | null
  createdAt: number
}

export function defaultCategory(id: string): TicketCategory {
  return {
    id,
    categoryId: null,
    emoji: "🎫",
    channelNamePattern: "{ticketNumber}-{memberDisplayName}",
    openText: "",
    openEmbed: emptyEmbed(),
    staffRoleIds: [],
    mentionRoleIds: [],
  }
}

export function defaultConfig(guildId: string): TicketsConfig {
  return {
    guildId,
    type: "button",
    claimEnabled: true,
    requiredRoleIds: [],
    blacklistRoleIds: [],
    logsChannelId: null,
    embed: emptyEmbed(),
    categories: [],
    panelChannelId: null,
    panelMessageId: null,
    counter: 0,
  }
}

const embedSchema = new Schema(
  {
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    color: { type: String, default: null },
    imageUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    footer: { type: String, default: "" },
  },
  { _id: false }
)

const categorySchema = new Schema(
  {
    id: { type: String, required: true },
    categoryId: { type: String, default: null },
    emoji: { type: String, default: "🎫" },
    channelNamePattern: { type: String, default: "{ticketNumber}-{memberDisplayName}" },
    openText: { type: String, default: "" },
    openEmbed: { type: embedSchema, default: () => ({}) },
    staffRoleIds: { type: [String], default: [] },
    mentionRoleIds: { type: [String], default: [] },
  },
  { _id: false }
)

const ticketsSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ["button", "select"], default: "button" },
    claimEnabled: { type: Boolean, default: true },
    requiredRoleIds: { type: [String], default: [] },
    blacklistRoleIds: { type: [String], default: [] },
    logsChannelId: { type: String, default: null },
    embed: { type: embedSchema, default: () => ({}) },
    categories: { type: [categorySchema], default: [] },
    panelChannelId: { type: String, default: null },
    panelMessageId: { type: String, default: null },
    counter: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const Tickets = model("Tickets", ticketsSchema, "tickets")

const ticketRecordSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    categoryId: { type: String, required: true },
    number: { type: Number, required: true },
    claimedBy: { type: String, default: null },
    closedAt: { type: Number, default: null },
    createdAt: { type: Number, required: true },
  },
  { timestamps: true }
)

export const TicketRecords = model("TicketRecords", ticketRecordSchema, "tickets_records")

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(0, 25)
}

function clampText(value: string, max: number): string {
  return value.trim().slice(0, max)
}

export function clampPattern(value: string): string {
  return clampText(value, MAX_PATTERN_LENGTH)
}

export function clampOpenText(value: string): string {
  return clampText(value, MAX_OPEN_TEXT_LENGTH)
}

export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim())
}

export function normalizeEmoji(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 16) return null
  const stripped = trimmed.replace(/[\uFE0F\u200D]/g, "")
  for (const char of stripped) {
    if (!/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}/u.test(char)) return null
  }
  return trimmed
}

function normalizeEmbed(raw: Record<string, unknown> | undefined | null): TicketEmbedConfig {
  const color = asStringOrNull(raw?.color, null)
  return {
    title: asString(raw?.title, "").slice(0, 256),
    description: asString(raw?.description, "").slice(0, 4000),
    color: color && isValidHexColor(color) ? color.toLowerCase() : null,
    imageUrl: asStringOrNull(raw?.imageUrl, null),
    thumbnailUrl: asStringOrNull(raw?.thumbnailUrl, null),
    footer: asString(raw?.footer, "").slice(0, 256),
  }
}

function normalizeCategories(raw: unknown): TicketCategory[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TicketCategory[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === "string" ? record.id.slice(0, 32) : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    const rawOpenEmbed =
      typeof record.openEmbed === "object" && record.openEmbed !== null
        ? (record.openEmbed as Record<string, unknown>)
        : {}
    const openEmbed = normalizeEmbed(rawOpenEmbed)
    const legacyTitle = asString(record.embedTitle, "").trim()
    const legacyColor = asStringOrNull(record.embedColor, null)
    const legacyImage = asStringOrNull(record.embedImageUrl, null)
    const legacyThumb = asStringOrNull(record.embedThumbnailUrl, null)
    const legacyFooter = asString(record.embedFooter, "").trim()
    if (legacyTitle && !openEmbed.title) openEmbed.title = legacyTitle.slice(0, 256)
    if (legacyColor && isValidHexColor(legacyColor) && !openEmbed.color) openEmbed.color = legacyColor.toLowerCase()
    if (legacyImage && !openEmbed.imageUrl) openEmbed.imageUrl = legacyImage
    if (legacyThumb && !openEmbed.thumbnailUrl) openEmbed.thumbnailUrl = legacyThumb
    if (legacyFooter && !openEmbed.footer) openEmbed.footer = legacyFooter.slice(0, 200)
    const legacyOpenText = clampOpenText(asString(record.openText, ""))
    if (!openEmbed.description && legacyOpenText) openEmbed.description = legacyOpenText.slice(0, 4000)
    out.push({
      id,
      categoryId: asStringOrNull(record.categoryId, null),
      emoji: normalizeEmoji(asString(record.emoji, "🎫")) ?? "🎫",
      channelNamePattern: clampPattern(asString(record.channelNamePattern, "{ticketNumber}")) || "{ticketNumber}",
      openText: legacyOpenText,
      openEmbed,
      staffRoleIds: asStringArray(record.staffRoleIds).slice(0, 10),
      mentionRoleIds: asStringArray(record.mentionRoleIds).slice(0, 10),
    })
  }
  return out.slice(0, MAX_CATEGORIES)
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): TicketsConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  const rawRecord = (raw ?? {}) as Record<string, unknown>
  const rawEmbed = (typeof rawRecord.embed === "object" && rawRecord.embed !== null ? rawRecord.embed : {}) as Record<
    string,
    unknown
  >
  const type = rawRecord.type === "select" ? "select" : "button"
  return {
    guildId,
    type,
    claimEnabled: asBoolean(rawRecord.claimEnabled, defaults.claimEnabled),
    requiredRoleIds: asStringArray(rawRecord.requiredRoleIds).slice(0, 1),
    blacklistRoleIds: asStringArray(rawRecord.blacklistRoleIds).slice(0, 10),
    logsChannelId: asStringOrNull(rawRecord.logsChannelId, defaults.logsChannelId),
    embed: normalizeEmbed(rawEmbed),
    categories: normalizeCategories(rawRecord.categories),
    panelChannelId: asStringOrNull(rawRecord.panelChannelId, defaults.panelChannelId),
    panelMessageId: asStringOrNull(rawRecord.panelMessageId, defaults.panelMessageId),
    counter:
      typeof rawRecord.counter === "number" && Number.isFinite(rawRecord.counter) && rawRecord.counter > 0
        ? Math.floor(rawRecord.counter)
        : defaults.counter,
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: TicketsConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<TicketsConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await Tickets.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<TicketsConfig> {
  await Tickets.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export async function nextTicketNumber(guildId: string): Promise<number> {
  invalidateConfig(guildId)
  const doc = await Tickets.findOneAndUpdate({ guildId }, { $inc: { counter: 1 } }, { upsert: true, new: true })
  return typeof doc?.counter === "number" && doc.counter > 0 ? Math.floor(doc.counter) : 1
}

export function generateCategoryId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
