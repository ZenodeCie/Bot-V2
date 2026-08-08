import { Schema, model } from "mongoose"

export const PUNISHMENTS = ["warn", "timeout", "kick", "ban", "lockdown", "none"] as const
export type Punishment = (typeof PUNISHMENTS)[number]

export const MODULES = [
  "spam",
  "mentions",
  "links",
  "emojis",
  "joins",
  "bots",
  "nuke",
  "selfbots",
  "alts",
  "verify",
] as const
export type ModuleName = (typeof MODULES)[number]

export const PREMIUM_MODULES: ModuleName[] = ["alts", "verify"]

export const MODULE_LABELS: Record<ModuleName, string> = {
  spam: "Anti-Spam",
  mentions: "Anti-Mention",
  links: "Anti-Lien",
  emojis: "Anti-Émoji",
  joins: "Anti-Raid (flood de membres)",
  bots: "Anti-Bot",
  nuke: "Anti-Nuke",
  selfbots: "Anti-Selfbot",
  alts: "Anti-Alts",
  verify: "Vérification",
}

export const PUNISHMENT_LABELS: Record<Punishment, string> = {
  warn: "Avertir",
  timeout: "Exclusion temporaire",
  kick: "Expulser",
  ban: "Bannir",
  lockdown: "Verrouillage",
  none: "Aucune",
}

export interface ModuleSettings {
  enabled: boolean
  limit: number
  interval: number
  punishment: Punishment
  duration: number
  maxAge: number
  role: string | null
}

const DAY = 24 * 60 * 60 * 1000
const MIN = 60 * 1000
const HOUR = 60 * MIN

export const MODULE_DEFAULTS: Record<ModuleName, ModuleSettings> = {
  spam: { enabled: false, limit: 5, interval: 5 * 1000, punishment: "timeout", duration: 10 * MIN, maxAge: 0, role: null },
  mentions: { enabled: false, limit: 5, interval: 3 * 1000, punishment: "timeout", duration: 10 * MIN, maxAge: 0, role: null },
  links: { enabled: false, limit: 3, interval: 10 * 1000, punishment: "timeout", duration: HOUR, maxAge: 0, role: null },
  emojis: { enabled: false, limit: 10, interval: 3 * 1000, punishment: "timeout", duration: 10 * MIN, maxAge: 0, role: null },
  joins: { enabled: false, limit: 6, interval: 10 * 1000, punishment: "ban", duration: 0, maxAge: 0, role: null },
  bots: { enabled: false, limit: 3, interval: 10 * 1000, punishment: "ban", duration: 0, maxAge: 0, role: null },
  nuke: { enabled: false, limit: 3, interval: 5 * 1000, punishment: "lockdown", duration: HOUR, maxAge: 0, role: null },
  selfbots: { enabled: false, limit: 3, interval: 5 * 1000, punishment: "ban", duration: 0, maxAge: 0, role: null },
  alts: { enabled: false, limit: 1, interval: 0, punishment: "kick", duration: 0, maxAge: 7 * DAY, role: null },
  verify: { enabled: false, limit: 1, interval: 0, punishment: "timeout", duration: 15 * MIN, maxAge: 0, role: null },
}

export interface AntiRaidConfig {
  guildId: string
  enabled: boolean
  premium: boolean
  raidMode: boolean
  raidEndsAt: number
  raidDuration: number
  logChannel: string | null
  whitelistedUsers: string[]
  whitelistedRoles: string[]
  modules: Record<ModuleName, ModuleSettings>
}

const moduleSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    limit: { type: Number, default: 5 },
    interval: { type: Number, default: 5000 },
    punishment: { type: String, enum: PUNISHMENTS, default: "timeout" },
    duration: { type: Number, default: 600000 },
    maxAge: { type: Number, default: 0 },
    role: { type: String, default: null },
  },
  { _id: false }
)

const modulesSchema = new Schema(
  {
    spam: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.spam }) },
    mentions: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.mentions }) },
    links: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.links }) },
    emojis: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.emojis }) },
    joins: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.joins }) },
    bots: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.bots }) },
    nuke: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.nuke }) },
    selfbots: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.selfbots }) },
    alts: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.alts }) },
    verify: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.verify }) },
  },
  { _id: false }
)

const antiRaidSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    premium: { type: Boolean, default: false },
    raidMode: { type: Boolean, default: false },
    raidEndsAt: { type: Number, default: 0 },
    raidDuration: { type: Number, default: HOUR },
    logChannel: { type: String, default: null },
    whitelistedUsers: { type: [String], default: [] },
    whitelistedRoles: { type: [String], default: [] },
    modules: { type: modulesSchema, default: () => ({}) },
  },
  { timestamps: true }
)

export const AntiRaid = model("AntiRaid", antiRaidSchema, "antiraid")

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): AntiRaidConfig {
  const modules = (raw?.modules as Record<string, Partial<ModuleSettings>> | undefined) ?? {}
  const normalizedModules = {} as Record<ModuleName, ModuleSettings>

  for (const name of MODULES) {
    const base = MODULE_DEFAULTS[name]
    const value = modules[name] ?? {}
    normalizedModules[name] = {
      enabled: typeof value.enabled === "boolean" ? value.enabled : base.enabled,
      limit: typeof value.limit === "number" ? value.limit : base.limit,
      interval: typeof value.interval === "number" ? value.interval : base.interval,
      punishment: PUNISHMENTS.includes(value.punishment as Punishment) ? (value.punishment as Punishment) : base.punishment,
      duration: typeof value.duration === "number" ? value.duration : base.duration,
      maxAge: typeof value.maxAge === "number" ? value.maxAge : base.maxAge,
      role: typeof value.role === "string" ? value.role : base.role,
    }
  }

  return {
    guildId: typeof raw?.guildId === "string" ? raw.guildId : "",
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : false,
    premium: typeof raw?.premium === "boolean" ? raw.premium : false,
    raidMode: typeof raw?.raidMode === "boolean" ? raw.raidMode : false,
    raidEndsAt: typeof raw?.raidEndsAt === "number" ? raw.raidEndsAt : 0,
    raidDuration: typeof raw?.raidDuration === "number" ? raw.raidDuration : HOUR,
    logChannel: typeof raw?.logChannel === "string" ? raw.logChannel : null,
    whitelistedUsers: Array.isArray(raw?.whitelistedUsers) ? (raw.whitelistedUsers as string[]) : [],
    whitelistedRoles: Array.isArray(raw?.whitelistedRoles) ? (raw.whitelistedRoles as string[]) : [],
    modules: normalizedModules,
  }
}

export async function getConfig(guildId: string): Promise<AntiRaidConfig> {
  const raw = await AntiRaid.findOne({ guildId }).lean()
  return normalizeConfig(raw ?? null)
}
