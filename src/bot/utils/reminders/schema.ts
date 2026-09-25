import { randomBytes } from "node:crypto"
import { Schema, model } from "mongoose"
import { botRuntime } from "../../config.js"
import type { RemindersBotSettings } from "../../../shared/botConfig.js"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"
import { normalizeWebhookUrl, webhookIdOf } from "./webhook.js"

/**
 * Modèle de données du module Rappels.
 *
 * Les réglages viennent de deux sources : les défauts par bot lus dans
 * `configs/{bot_id}.json` (clé `reminders`) et une surcharge par salon, saisie
 * depuis `/config`. L'ordre de précédence est toujours salon > bot > codé en dur.
 */

export const REMINDER_DESTINATIONS = ["dm", "salon", "webhook"] as const
export type ReminderDestination = (typeof REMINDER_DESTINATIONS)[number]

export const REMINDER_RECURRENCES = ["none", "daily", "weekly", "monthly", "custom"] as const
export type ReminderRecurrence = (typeof REMINDER_RECURRENCES)[number]

export const MAX_MESSAGE_LENGTH = 2000
export const MAX_MENTIONS_PER_KIND = 10
export const MIN_LEAD_MS = 30_000
export const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000
export const MIN_REMINDERS_PER_USER = 1
export const MAX_REMINDERS_PER_USER = 500
export const DEFAULT_REMINDERS_PER_USER = 10

const SNOWFLAKE_RE = /^\d{17,20}$/
const REMINDER_ID_RE = /^[a-f0-9]{24}$/i

export interface ReminderRecord {
  id: string
  guildId: string
  authorId: string
  message: string
  destination: ReminderDestination
  channelId: string | null
  webhookUrl: string | null
  webhookId: string | null
  recurrence: ReminderRecurrence
  cronExpr: string | null
  nextAt: number
  paused: boolean
  mentionUserIds: string[]
  mentionRoleIds: string[]
  createdAt: number
  lastError: string | null
}

export interface RemindersSettings {
  adminOnly: boolean
  maxRemindersPerUser: number
  allowWebhookDestination: boolean
}

/** Surcharge par salon : seuls les champs explicitement définis sont stockés. */
export type RemindersSettingsOverride = Partial<RemindersSettings>

export const RECURRENCE_LABELS: Record<ReminderRecurrence, string> = {
  none: "Une fois",
  daily: "Quotidien",
  weekly: "Hebdomadaire",
  monthly: "Mensuel",
  custom: "Cron",
}

export const DESTINATION_LABELS: Record<ReminderDestination, string> = {
  dm: "Message privé",
  salon: "Salon",
  webhook: "Webhook",
}

export function newReminderId(): string {
  return randomBytes(12).toString("hex")
}

export function isReminderId(value: string): boolean {
  return REMINDER_ID_RE.test(value)
}

export function clampMessage(value: string): string {
  return value.trim().slice(0, MAX_MESSAGE_LENGTH)
}

export function clampMaxReminders(value: number): number {
  const rounded = Math.floor(value)
  return Math.min(MAX_REMINDERS_PER_USER, Math.max(MIN_REMINDERS_PER_USER, rounded))
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asDestination(value: unknown): ReminderDestination {
  return REMINDER_DESTINATIONS.includes(value as ReminderDestination) ? (value as ReminderDestination) : "dm"
}

function asRecurrence(value: unknown): ReminderRecurrence {
  return REMINDER_RECURRENCES.includes(value as ReminderRecurrence) ? (value as ReminderRecurrence) : "none"
}

function asSnowflake(value: unknown): string | null {
  return typeof value === "string" && SNOWFLAKE_RE.test(value) ? value : null
}

function asSnowflakeList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const id = asSnowflake(item)
    if (!id || out.includes(id)) continue
    out.push(id)
    if (out.length >= max) break
  }
  return out
}

/** Les timestamps mongoose arrivent en `Date`, le backend fichier en nombre. */
function asTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  return asNumber(value, Date.now())
}

// ---------------------------------------------------------------------------
// Mongo
// ---------------------------------------------------------------------------

const configSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    adminOnly: { type: Boolean, default: null },
    maxRemindersPerUser: { type: Number, default: null },
    allowWebhookDestination: { type: Boolean, default: null },
  },
  { timestamps: true }
)

applyBotScope(configSchema)
uniqueBotGuildIndex(configSchema)

export const RemindersConfigModel = model("RemindersConfig", configSchema, "reminders_config")

const reminderSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    authorId: { type: String, required: true, index: true },
    message: { type: String, required: true, default: "" },
    destination: { type: String, default: "dm" },
    channelId: { type: String, default: null },
    webhookUrl: { type: String, default: null },
    webhookId: { type: String, default: null },
    recurrence: { type: String, default: "none" },
    cronExpr: { type: String, default: null },
    nextAt: { type: Number, required: true, index: true },
    paused: { type: Boolean, default: false, index: true },
    mentionUserIds: { type: [String], default: [] },
    mentionRoleIds: { type: [String], default: [] },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
)

applyBotScope(reminderSchema)
reminderSchema.index({ botId: 1, guildId: 1, authorId: 1 })
reminderSchema.index({ botId: 1, guildId: 1, nextAt: 1 })

export const ReminderModel = model("Reminder", reminderSchema, "reminders")

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export function normalizeOverride(raw: Record<string, unknown> | null | undefined): RemindersSettingsOverride {
  if (!raw) return {}
  const override: RemindersSettingsOverride = {}
  if (typeof raw.adminOnly === "boolean") override.adminOnly = raw.adminOnly
  if (typeof raw.allowWebhookDestination === "boolean") override.allowWebhookDestination = raw.allowWebhookDestination
  const max = asNumber(raw.maxRemindersPerUser, Number.NaN)
  if (Number.isFinite(max)) override.maxRemindersPerUser = clampMaxReminders(max)
  return override
}

export function normalizeRecord(raw: Record<string, unknown> | null | undefined): ReminderRecord | null {
  if (!raw) return null
  const idRaw = raw.id ?? raw._id
  const id = typeof idRaw === "string" ? idRaw : idRaw != null ? String(idRaw) : ""
  if (!isReminderId(id)) return null

  const guildId = asStringOrNull(raw.guildId)
  const authorId = asStringOrNull(raw.authorId)
  const message = clampMessage(typeof raw.message === "string" ? raw.message : "")
  // Un rappel sans message ni échéance n'est pas exploitable : on l'écarte.
  if (!guildId || !authorId || !message) return null

  const destination = asDestination(raw.destination)
  const webhookUrl = normalizeWebhookUrl(raw.webhookUrl)

  return {
    id,
    guildId,
    authorId,
    message,
    destination,
    channelId: asSnowflake(raw.channelId),
    webhookUrl,
    webhookId: webhookIdOf(webhookUrl),
    recurrence: asRecurrence(raw.recurrence),
    cronExpr: asStringOrNull(raw.cronExpr),
    nextAt: asNumber(raw.nextAt, 0),
    paused: asBoolean(raw.paused, false),
    mentionUserIds: asSnowflakeList(raw.mentionUserIds, MAX_MENTIONS_PER_KIND),
    mentionRoleIds: asSnowflakeList(raw.mentionRoleIds, MAX_MENTIONS_PER_KIND),
    createdAt: asTimestamp(raw.createdAt),
    lastError: asStringOrNull(raw.lastError),
  }
}

// ---------------------------------------------------------------------------
// Résolution des réglages
// ---------------------------------------------------------------------------

/** Défauts par bot, lus dans `configs/{bot_id}.json` → clé `reminders`. */
export function botDefaults(): RemindersSettings {
  const raw = (botRuntime.raw.reminders ?? {}) as RemindersBotSettings
  return {
    adminOnly: raw.adminOnly === true,
    maxRemindersPerUser: clampMaxReminders(asNumber(raw.maxRemindersPerUser, DEFAULT_REMINDERS_PER_USER)),
    allowWebhookDestination: raw.allowWebhookDestination === true,
  }
}

export function applyOverride(base: RemindersSettings, override: RemindersSettingsOverride): RemindersSettings {
  return {
    adminOnly: override.adminOnly ?? base.adminOnly,
    maxRemindersPerUser: override.maxRemindersPerUser ?? base.maxRemindersPerUser,
    allowWebhookDestination: override.allowWebhookDestination ?? base.allowWebhookDestination,
  }
}
