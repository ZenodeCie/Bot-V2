import { randomBytes } from "node:crypto"
import { Schema, model } from "mongoose"
import { parseHexColor } from "../../../shared/botConfig.js"
import { applyBotScope } from "../mongoScope.js"
import parseTime from "../parseTime.js"

/**
 * reactionroles — modèle de données + validations.
 * Source de vérité : ce fichier (Mongo et fallback fichiers utilisent le même modèle).
 */

export const PANEL_MODES = ["normal", "unique", "verify", "drop", "reversed"] as const
export type PanelMode = (typeof PANEL_MODES)[number]

export const ENTRY_TYPES = ["reaction", "button", "select"] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

export const PANEL_LANGUAGES = ["fr", "en"] as const
export type PanelLanguage = (typeof PANEL_LANGUAGES)[number]

export const PANEL_LIMITS = {
  MAX_PANEL_NAME: 60,
  MAX_ENTRY_LABEL: 100,
  MAX_ENTRIES: 48,
  MAX_ROLES_PER_ENTRY: 12,
  MAX_RESTRICT_ROLES: 20,
  MAX_EMBED_TITLE: 256,
  MAX_EMBED_DESCRIPTION: 4096,
  MAX_EMBED_URL: 2048,
  MAX_EMBED_FIELDS: 25,
  MAX_FIELD_NAME: 256,
  MAX_FIELD_VALUE: 1024,
  MAX_EMBED_FOOTER: 2048,
  MAX_EMBED_AUTHOR: 256,
  MAX_RESPONSE_TEXT: 2048,
  MAX_DURATION_MS: 365 * 24 * 60 * 60 * 1000,
  MAX_MAX_ROLES: 50,
  MAX_COOLDOWN_MS: 24 * 60 * 60 * 1000,
} as const

const SNOWFLAKE_RE = /^\d{16,22}$/

export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && SNOWFLAKE_RE.test(value)
}

export function isPanelMode(value: unknown): value is PanelMode {
  return typeof value === "string" && (PANEL_MODES as readonly string[]).includes(value)
}

export function isEntryType(value: unknown): value is EntryType {
  return typeof value === "string" && (ENTRY_TYPES as readonly string[]).includes(value)
}

export function isPanelLanguage(value: unknown): value is PanelLanguage {
  return typeof value === "string" && (PANEL_LANGUAGES as readonly string[]).includes(value)
}

export function newPanelId(): string {
  return randomBytes(4).toString("hex")
}

export function newEntryId(): string {
  return randomBytes(3).toString("hex")
}

export function newGrantId(): string {
  return randomBytes(6).toString("hex")
}

export interface ReactionEmoji {
  name: string
  id: string | null
  animated: boolean
}

export function emojiKey(emoji: ReactionEmoji | null | undefined): string {
  if (!emoji) return ""
  return emoji.id ?? emoji.name
}

export function parseEmojiToken(value: unknown): ReactionEmoji | null {
  if (typeof value === "string") {
    const str = value.trim()
    const animated = /^<a:/.test(str)
    const match = /^<a?:([a-zA-Z0-9_]{2,32}):(\d{16,22})>$/.exec(str)
    if (match) return { name: match[1], id: match[2], animated }
    if (SNOWFLAKE_RE.test(str)) return { name: "", id: str, animated: false }
    if (str.length > 0 && str.length <= 32) return { name: str, id: null, animated: false }
    return null
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name : ""
    const id = isSnowflake(record.id) ? record.id : null
    const animated = record.animated === true
    if (id || name) return { name, id, animated }
  }
  return null
}

export function emojiDisplay(emoji: ReactionEmoji | null | undefined): string {
  if (!emoji) return ""
  if (emoji.id) return emoji.animated ? `<a:${emoji.name || "e"}:${emoji.id}>` : `<:${emoji.name || "e"}:${emoji.id}>`
  return emoji.name
}

export interface PanelEmbedField {
  name: string
  value: string
  inline: boolean
}

export interface PanelEmbedConfig {
  title: string
  description: string
  color: string
  image: string | null
  thumbnail: string | null
  author: string | null
  footer: string | null
  fields: PanelEmbedField[]
}

export interface PanelResponses {
  granted: string
  removed: string
  denied: string
  cooldown: string
  limit: string
  error: string
  dmGranted: string
  dmRemoved: string
  logGrant: string
  logRemove: string
  logDeny: string
}

export interface RolePanelEntry {
  id: string
  entryType: EntryType
  label: string
  emoji: ReactionEmoji | null
  style: number
  roles: string[]
  removeRoles: string[]
  durationMs: number | null
  requiredRoles: string[]
  deniedRoles: string[]
  minAccountAgeMs: number | null
  minMemberAgeMs: number | null
  enabled: boolean
}

export interface RolePanel {
  id: string
  guildId: string
  name: string
  enabled: boolean
  channelId: string | null
  messageId: string | null
  mode: PanelMode
  maxRoles: number | null
  cooldownMs: number | null
  language: PanelLanguage
  allowDangerousRoles: boolean
  dmNotify: boolean
  logChannelId: string | null
  embed: PanelEmbedConfig
  responses: PanelResponses
  entries: RolePanelEntry[]
  createdAt: number
  updatedAt: number
}

export interface TempRoleGrant {
  id: string
  guildId: string
  userId: string
  roleId: string
  panelId: string
  entryId: string
  grantedAt: number
  expiresAt: number
}

// ---------------------------------------------------------------------------
// Valeurs par défaut (FR/EN)
// ---------------------------------------------------------------------------

export function defaultEmbed(language: PanelLanguage = "fr"): PanelEmbedConfig {
  const french = language === "fr"
  return {
    title: french ? "Rôles-réactions" : "Reaction Roles",
    description: french
      ? "Réagissez avec l'emoji correspondant (ou utilisez les boutons / menus ci-dessous) pour obtenir vos rôles."
      : "React with the matching emoji (or use the buttons / menus below) to get your roles.",
    color: "#5865f2",
    image: null,
    thumbnail: null,
    author: null,
    footer: null,
    fields: [],
  }
}

export const DEFAULT_RESPONSES_FR: PanelResponses = {
  granted: "> {emoji} *Rôle(s) accordé(s) :* {role}",
  removed: "> {emoji} *Rôle(s) retiré(s) :* {role}",
  denied: "> ❌ *Action refusée :* {reason}",
  cooldown: "> ⏱️ *Merci de patienter avant de réessayer.*",
  limit: "> ⛔ *Vous avez atteint la limite de rôles de ce panel.*",
  error: "> ⚠️ *Une erreur est survenue. Contactez un modérateur.*",
  dmGranted: "Vous avez reçu le rôle **{role}** sur **{server}** (panel **{panel}**).",
  dmRemoved: "Votre rôle **{role}** a été retiré sur **{server}** (panel **{panel}**).",
  logGrant: "**Rôle ajouté** — {user} → {role} (panel **{panel}**)",
  logRemove: "**Rôle retiré** — {user} → {role} (panel **{panel}**)",
  logDeny: "**Refusé** — {user} → {role} (panel **{panel}**) — {reason}",
}

export const DEFAULT_RESPONSES_EN: PanelResponses = {
  granted: "> {emoji} *Role(s) granted:* {role}",
  removed: "> {emoji} *Role(s) removed:* {role}",
  denied: "> ❌ *Action denied:* {reason}",
  cooldown: "> ⏱️ *Please wait before trying again.*",
  limit: "> ⛔ *You reached the role limit of this panel.*",
  error: "> ⚠️ *An error occurred. Please contact a moderator.*",
  dmGranted: "You received the role **{role}** on **{server}** (panel **{panel}**).",
  dmRemoved: "Your role **{role}** was removed on **{server}** (panel **{panel}**).",
  logGrant: "**Role granted** — {user} → {role} (panel **{panel}**)",
  logRemove: "**Role removed** — {user} → {role} (panel **{panel}**)",
  logDeny: "**Denied** — {user} → {role} (panel **{panel}**) — {reason}",
}

export function defaultResponses(language: PanelLanguage = "fr"): PanelResponses {
  return { ...(language === "en" ? DEFAULT_RESPONSES_EN : DEFAULT_RESPONSES_FR) }
}

export function defaultEntry(entryType: EntryType, seed?: { label?: string; emoji?: ReactionEmoji | null }): RolePanelEntry {
  return {
    id: newEntryId(),
    entryType,
    label: seed?.label ?? "",
    emoji: seed?.emoji ?? null,
    style: 1,
    roles: [],
    removeRoles: [],
    durationMs: null,
    requiredRoles: [],
    deniedRoles: [],
    minAccountAgeMs: null,
    minMemberAgeMs: null,
    enabled: true,
  }
}

export function defaultPanel(guildId: string, language: PanelLanguage = "fr"): RolePanel {
  const now = Date.now()
  return {
    id: newPanelId(),
    guildId,
    name: "",
    enabled: true,
    channelId: null,
    messageId: null,
    mode: "normal",
    maxRoles: null,
    cooldownMs: null,
    language,
    allowDangerousRoles: false,
    dmNotify: false,
    logChannelId: null,
    embed: defaultEmbed(language),
    responses: defaultResponses(language),
    entries: [],
    createdAt: now,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Helpers de normalisation / clamp
// ---------------------------------------------------------------------------

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function clampText(value: string, max: number): string {
  return value.trim().slice(0, max)
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  return typeof value === "string" ? value.trim() : null
}

function clampNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(Math.floor(value), max))
  if (typeof value === "string" && /^\d+$/.test(value)) return Math.min(Number(value), max)
  return fallback
}

function snowflakeList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (seen.size >= max) break
    if (isSnowflake(item)) seen.add(item)
  }
  return [...seen]
}

export function parseDurationMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), PANEL_LIMITS.MAX_DURATION_MS)
  }
  if (typeof value === "string") {
    const parsed = parseTime(value)
    if (parsed !== null && parsed > 0) return Math.min(parsed, PANEL_LIMITS.MAX_DURATION_MS)
  }
  return null
}

export function normalizeEmoji(raw: unknown): ReactionEmoji | null {
  return parseEmojiToken(raw)
}

export function normalizeEmbed(raw: Record<string, unknown> | null | undefined, language: PanelLanguage = "fr"): PanelEmbedConfig {
  const defaults = defaultEmbed(language)
  if (!raw || typeof raw !== "object") return defaults
  const color = parseHexColor(raw.color, "#5865f2")
  const fieldsRaw = Array.isArray(raw.fields) ? raw.fields : []
  const fields: PanelEmbedField[] = []
  for (const field of fieldsRaw) {
    if (fields.length >= PANEL_LIMITS.MAX_EMBED_FIELDS) break
    if (!field || typeof field !== "object") continue
    const record = field as Record<string, unknown>
    const name = clampText(asString(record.name, ""), PANEL_LIMITS.MAX_FIELD_NAME)
    const value = clampText(asString(record.value, ""), PANEL_LIMITS.MAX_FIELD_VALUE)
    if (!name && !value) continue
    fields.push({ name, value, inline: record.inline === true })
  }
  return {
    title: clampText(asString(raw.title, defaults.title), PANEL_LIMITS.MAX_EMBED_TITLE),
    description: clampText(asString(raw.description, defaults.description), PANEL_LIMITS.MAX_EMBED_DESCRIPTION),
    color,
    image: asStringOrNull(raw.image),
    thumbnail: asStringOrNull(raw.thumbnail),
    author: asStringOrNull(raw.author),
    footer: asStringOrNull(raw.footer),
    fields,
  }
}

export function normalizeResponses(raw: Record<string, unknown> | null | undefined, language: PanelLanguage = "fr"): PanelResponses {
  const defaults = defaultResponses(language)
  if (!raw || typeof raw !== "object") return defaults
  const out = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof PanelResponses)[]) {
    const value = raw[key]
    if (typeof value === "string" && value.trim()) out[key] = clampText(value, PANEL_LIMITS.MAX_RESPONSE_TEXT)
  }
  return out
}

export function normalizeEntry(raw: Record<string, unknown> | null | undefined): RolePanelEntry {
  if (!raw || typeof raw !== "object") return defaultEntry("reaction")
  const entryType = isEntryType(raw.entryType) ? raw.entryType : "reaction"
  const base = defaultEntry(entryType, { label: asString(raw.label, ""), emoji: parseEmojiToken(raw.emoji) })
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id.slice(0, 32) : base.id
  return {
    id,
    entryType,
    label: clampText(asString(raw.label, ""), PANEL_LIMITS.MAX_ENTRY_LABEL),
    emoji: parseEmojiToken(raw.emoji ?? base.emoji),
    style: clampNumber(raw.style ?? base.style, base.style, 5),
    roles: snowflakeList(raw.roles, PANEL_LIMITS.MAX_ROLES_PER_ENTRY),
    removeRoles: snowflakeList(raw.removeRoles, PANEL_LIMITS.MAX_ROLES_PER_ENTRY),
    durationMs: raw.durationMs === null || raw.durationMs === undefined || raw.durationMs === "" ? null : parseDurationMs(raw.durationMs),
    requiredRoles: snowflakeList(raw.requiredRoles, PANEL_LIMITS.MAX_RESTRICT_ROLES),
    deniedRoles: snowflakeList(raw.deniedRoles, PANEL_LIMITS.MAX_RESTRICT_ROLES),
    minAccountAgeMs:
      raw.minAccountAgeMs === null || raw.minAccountAgeMs === undefined || raw.minAccountAgeMs === ""
        ? null
        : parseDurationMs(raw.minAccountAgeMs),
    minMemberAgeMs:
      raw.minMemberAgeMs === null || raw.minMemberAgeMs === undefined || raw.minMemberAgeMs === ""
        ? null
        : parseDurationMs(raw.minMemberAgeMs),
    enabled: asBoolean(raw.enabled, true),
  }
}

export function normalizePanel(raw: Record<string, unknown> | null | undefined, language: PanelLanguage = "fr"): RolePanel {
  if (!raw || typeof raw !== "object") return defaultPanel("", language)
  const guildId = typeof raw.guildId === "string" ? raw.guildId : ""
  const lang = isPanelLanguage(raw.language) ? raw.language : language
  const fallback = defaultPanel(guildId, lang)
  const now = Date.now()
  const entriesRaw = Array.isArray(raw.entries) ? raw.entries : []
  const entries = entriesRaw
    .slice(0, PANEL_LIMITS.MAX_ENTRIES)
    .map((entry) => normalizeEntry(entry as Record<string, unknown> | null | undefined))
  return {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id.slice(0, 32) : fallback.id,
    guildId,
    name: clampText(asString(raw.name, fallback.name), PANEL_LIMITS.MAX_PANEL_NAME),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    channelId: asStringOrNull(raw.channelId) && isSnowflake(raw.channelId) ? String(raw.channelId) : null,
    messageId: asStringOrNull(raw.messageId) && isSnowflake(raw.messageId) ? String(raw.messageId) : null,
    mode: isPanelMode(raw.mode) ? raw.mode : fallback.mode,
    maxRoles:
      typeof raw.maxRoles === "number" && Number.isFinite(raw.maxRoles) && raw.maxRoles > 0
        ? Math.min(Math.floor(raw.maxRoles), PANEL_LIMITS.MAX_MAX_ROLES)
        : null,
    cooldownMs:
      typeof raw.cooldownMs === "number" && Number.isFinite(raw.cooldownMs) && raw.cooldownMs > 0
        ? Math.min(Math.floor(raw.cooldownMs), PANEL_LIMITS.MAX_COOLDOWN_MS)
        : null,
    language: lang,
    allowDangerousRoles: asBoolean(raw.allowDangerousRoles, false),
    dmNotify: asBoolean(raw.dmNotify, false),
    logChannelId: isSnowflake(raw.logChannelId) ? String(raw.logChannelId) : null,
    embed: normalizeEmbed(raw.embed as Record<string, unknown> | null | undefined, lang),
    responses: normalizeResponses(raw.responses as Record<string, unknown> | null | undefined, lang),
    entries,
    createdAt: typeof raw.createdAt === "number" && raw.createdAt > 0 ? Math.floor(raw.createdAt) : now,
    updatedAt: typeof raw.updatedAt === "number" && raw.updatedAt > 0 ? Math.floor(raw.updatedAt) : now,
  }
}

export function normalizePanelInput(value: unknown): RolePanel | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.guildId !== "string" || !record.guildId) return null
  const panel = normalizePanel(record, isPanelLanguage(record.language) ? record.language : "fr")
  if (!panel.name && panel.entries.length === 0) return null
  return panel
}

export function normalizeGrant(raw: Record<string, unknown>): TempRoleGrant {
  return {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : newGrantId(),
    guildId: String(raw.guildId ?? ""),
    userId: String(raw.userId ?? ""),
    roleId: String(raw.roleId ?? ""),
    panelId: String(raw.panelId ?? ""),
    entryId: String(raw.entryId ?? ""),
    grantedAt: typeof raw.grantedAt === "number" ? Math.floor(raw.grantedAt) : Date.now(),
    expiresAt: typeof raw.expiresAt === "number" ? Math.floor(raw.expiresAt) : Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Modèles Mongo (scoped botId — collection partagée)
// ---------------------------------------------------------------------------

const panelSchema = new Schema(
  {
    panelId: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    mode: { type: String, default: "normal" },
    maxRoles: { type: Number, default: null },
    cooldownMs: { type: Number, default: null },
    language: { type: String, default: "fr" },
    allowDangerousRoles: { type: Boolean, default: false },
    dmNotify: { type: Boolean, default: false },
    logChannelId: { type: String, default: null },
    embed: { type: Schema.Types.Mixed, default: {} },
    responses: { type: Schema.Types.Mixed, default: {} },
    entries: { type: Schema.Types.Mixed, default: [] },
    createdAt: { type: Number, default: 0 },
    updatedAt: { type: Number, default: 0 },
  },
  { collection: "reactionroles" }
)

applyBotScope(panelSchema)
panelSchema.index({ botId: 1, guildId: 1, panelId: 1 }, { unique: true })

export const ReactionRolePanels = model("ReactionRolePanels", panelSchema)

const tempGrantSchema = new Schema(
  {
    grantId: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    roleId: { type: String, required: true },
    panelId: { type: String, required: true },
    entryId: { type: String, required: true },
    grantedAt: { type: Number, required: true },
    expiresAt: { type: Number, required: true, index: true },
  },
  { collection: "reactionroles_temp" }
)

applyBotScope(tempGrantSchema)
tempGrantSchema.index({ botId: 1, guildId: 1, userId: 1, roleId: 1, panelId: 1, entryId: 1 }, { unique: true })

export const ReactionRoleTempGrants = model("ReactionRoleTempGrants", tempGrantSchema)

export function mapPanelDoc(doc: Record<string, unknown>): RolePanel {
  return normalizePanel({ ...doc, id: doc.panelId }, isPanelLanguage(doc.language) ? doc.language : "fr")
}

export function mapGrantDoc(doc: Record<string, unknown>): TempRoleGrant {
  return normalizeGrant({ ...doc, id: doc.grantId })
}