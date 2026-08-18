import { Schema, model } from "mongoose"

export interface CaptchaConfig {
  guildId: string
  enabled: boolean
  channelId: string | null
  roleId: string | null
  timeout: number
  maxAttempts: number
  kickOnFail: boolean
  ignoreBots: boolean
}

const MIN = 60 * 1000

export function defaultConfig(guildId: string): CaptchaConfig {
  return {
    guildId,
    enabled: false,
    channelId: null,
    roleId: null,
    timeout: 5 * MIN,
    maxAttempts: 3,
    kickOnFail: false,
    ignoreBots: true,
  }
}

const captchaSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    roleId: { type: String, default: null },
    timeout: { type: Number, default: 5 * MIN },
    maxAttempts: { type: Number, default: 3 },
    kickOnFail: { type: Boolean, default: false },
    ignoreBots: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Captcha = model("Captcha", captchaSchema, "captcha")

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asStringOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): CaptchaConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  const maxAttempts = Math.floor(asNumber(raw?.maxAttempts, defaults.maxAttempts))
  const timeout = Math.floor(asNumber(raw?.timeout, defaults.timeout))
  return {
    guildId,
    enabled: asBoolean(raw?.enabled, defaults.enabled),
    channelId: asStringOrNull(raw?.channelId, defaults.channelId),
    roleId: asStringOrNull(raw?.roleId, defaults.roleId),
    timeout: timeout > 0 ? timeout : defaults.timeout,
    maxAttempts: maxAttempts >= 1 ? maxAttempts : defaults.maxAttempts,
    kickOnFail: asBoolean(raw?.kickOnFail, defaults.kickOnFail),
    ignoreBots: asBoolean(raw?.ignoreBots, defaults.ignoreBots),
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: CaptchaConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<CaptchaConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await Captcha.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<CaptchaConfig> {
  await Captcha.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}
