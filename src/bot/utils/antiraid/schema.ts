import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"

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
  "badword",
] as const
export type ModuleName = (typeof MODULES)[number]

export const MODULE_LABELS: Record<ModuleName, string> = {
  spam: "Anti-Spam",
  mentions: "Anti-Mention",
  links: "Anti-Lien",
  emojis: "Anti-Émoji",
  joins: "Anti-Raid (flood de membres)",
  bots: "Anti-Bot",
  nuke: "Anti-Nuke",
  selfbots: "Anti-Selfbot",
  badword: "Anti-Mot Interdit",
}

export const PUNISHMENT_LABELS: Record<Punishment, string> = {
  warn: "Avertir",
  timeout: "Exclusion temporaire",
  kick: "Expulser",
  ban: "Bannir",
  lockdown: "Verrouillage",
  none: "Aucune",
}

export const MODES = ["off", "low", "balanced", "high", "maximum", "custom"] as const
export type AntiRaidMode = (typeof MODES)[number]

export const MODE_LABELS: Record<AntiRaidMode, string> = {
  off: "Désactivé",
  low: "Faible",
  balanced: "Équilibré",
  high: "Élevé",
  maximum: "Maximum",
  custom: "Personnalisé",
}

export interface ModuleSettings {
  enabled: boolean
  limit: number
  interval: number
  punishment: Punishment
  duration: number
  maxAge: number
  role: string | null
  maxUserMentions: number
  maxRoleMentions: number
  allowEveryone: boolean
  blockDiscordInvites: boolean
  allowedDomains: string[]
  blockedDomains: string[]
  bannedWords: string[]
  channelThreshold: number
  roleThreshold: number
  webhookThreshold: number
  custom: boolean
}

export interface HoneypotSettings {
  enabled: boolean
  channels: string[]
  roles: string[]
  punishment: Punishment
  duration: number
}

export interface QuarantineSettings {
  enabled: boolean
  role: string | null
  users: string[]
}

export interface LockdownSettings {
  slowmode: number
  blockJoins: boolean
  blockMessages: boolean
}

const MIN = 60 * 1000
const HOUR = 60 * MIN

function moduleBase(
  overrides: Partial<ModuleSettings> = {}
): ModuleSettings {
  return {
    enabled: false,
    limit: 5,
    interval: 5 * 1000,
    punishment: "timeout",
    duration: 10 * MIN,
    maxAge: 0,
    role: null,
    maxUserMentions: 5,
    maxRoleMentions: 2,
    allowEveryone: false,
    blockDiscordInvites: true,
    allowedDomains: [],
    blockedDomains: [],
    bannedWords: [],
    channelThreshold: 3,
    roleThreshold: 3,
    webhookThreshold: 3,
    custom: false,
    ...overrides,
  }
}

export const MODULE_DEFAULTS: Record<ModuleName, ModuleSettings> = {
  spam: moduleBase({ limit: 5, interval: 5 * 1000, punishment: "timeout", duration: 10 * MIN }),
  mentions: moduleBase({ limit: 5, interval: 3 * 1000, punishment: "timeout", duration: 10 * MIN, maxUserMentions: 5, maxRoleMentions: 2, allowEveryone: false }),
  links: moduleBase({ limit: 3, interval: 10 * 1000, punishment: "timeout", duration: HOUR, blockDiscordInvites: true }),
  emojis: moduleBase({ limit: 10, interval: 3 * 1000, punishment: "timeout", duration: 10 * MIN }),
  joins: moduleBase({ limit: 6, interval: 10 * 1000, punishment: "ban", duration: 0 }),
  bots: moduleBase({ limit: 3, interval: 10 * 1000, punishment: "ban", duration: 0 }),
  nuke: moduleBase({ limit: 3, interval: 5 * 1000, punishment: "lockdown", duration: HOUR, channelThreshold: 3, roleThreshold: 3, webhookThreshold: 3 }),
  selfbots: moduleBase({ limit: 3, interval: 5 * 1000, punishment: "ban", duration: 0 }),
  badword: moduleBase({ limit: 1, interval: 0, punishment: "timeout", duration: 10 * MIN, bannedWords: [] }),
}

type ModePreset = Partial<ModuleSettings> & { punishment?: Punishment }

export const MODE_PRESETS: Record<Exclude<AntiRaidMode, "custom">, Record<ModuleName, ModePreset>> = {
  off: {
    spam: { limit: 15, interval: 10 * 1000, punishment: "warn", duration: 0 },
    mentions: { limit: 12, interval: 10 * 1000, punishment: "warn", duration: 0 },
    links: { limit: 10, interval: 30 * 1000, punishment: "warn", duration: 0 },
    emojis: { limit: 25, interval: 10 * 1000, punishment: "warn", duration: 0 },
    joins: { limit: 15, interval: 30 * 1000, punishment: "kick", duration: 0 },
    bots: { limit: 5, interval: 30 * 1000, punishment: "kick", duration: 0 },
    nuke: { limit: 6, interval: 10 * 1000, punishment: "lockdown", duration: HOUR, channelThreshold: 6, roleThreshold: 6, webhookThreshold: 6 },
    selfbots: { limit: 8, interval: 10 * 1000, punishment: "kick", duration: 0 },
    badword: { limit: 1, interval: 0, punishment: "warn", duration: 0 },
  },
  low: {
    spam: { limit: 8, interval: 7 * 1000, punishment: "warn", duration: 0 },
    mentions: { limit: 8, interval: 5 * 1000, punishment: "warn", duration: 0 },
    links: { limit: 5, interval: 20 * 1000, punishment: "timeout", duration: 5 * MIN },
    emojis: { limit: 15, interval: 5 * 1000, punishment: "warn", duration: 0 },
    joins: { limit: 10, interval: 20 * 1000, punishment: "kick", duration: 0 },
    bots: { limit: 4, interval: 20 * 1000, punishment: "kick", duration: 0 },
    nuke: { limit: 4, interval: 8 * 1000, punishment: "lockdown", duration: 30 * MIN, channelThreshold: 4, roleThreshold: 4, webhookThreshold: 4 },
    selfbots: { limit: 5, interval: 8 * 1000, punishment: "kick", duration: 0 },
    badword: { limit: 1, interval: 0, punishment: "warn", duration: 0 },
  },
  balanced: {
    spam: { limit: 5, interval: 5 * 1000, punishment: "timeout", duration: 10 * MIN },
    mentions: { limit: 5, interval: 3 * 1000, punishment: "timeout", duration: 10 * MIN },
    links: { limit: 3, interval: 10 * 1000, punishment: "timeout", duration: HOUR },
    emojis: { limit: 10, interval: 3 * 1000, punishment: "timeout", duration: 10 * MIN },
    joins: { limit: 6, interval: 10 * 1000, punishment: "ban", duration: 0 },
    bots: { limit: 3, interval: 10 * 1000, punishment: "ban", duration: 0 },
    nuke: { limit: 3, interval: 5 * 1000, punishment: "lockdown", duration: HOUR, channelThreshold: 3, roleThreshold: 3, webhookThreshold: 3 },
    selfbots: { limit: 3, interval: 5 * 1000, punishment: "ban", duration: 0 },
    badword: { limit: 1, interval: 0, punishment: "timeout", duration: 10 * MIN },
  },
  high: {
    spam: { limit: 4, interval: 4 * 1000, punishment: "timeout", duration: 15 * MIN },
    mentions: { limit: 4, interval: 3 * 1000, punishment: "timeout", duration: 15 * MIN },
    links: { limit: 2, interval: 8 * 1000, punishment: "timeout", duration: 2 * HOUR },
    emojis: { limit: 8, interval: 3 * 1000, punishment: "timeout", duration: 15 * MIN },
    joins: { limit: 5, interval: 10 * 1000, punishment: "ban", duration: 0 },
    bots: { limit: 2, interval: 10 * 1000, punishment: "ban", duration: 0 },
    nuke: { limit: 2, interval: 5 * 1000, punishment: "ban", duration: 0, channelThreshold: 2, roleThreshold: 2, webhookThreshold: 2 },
    selfbots: { limit: 2, interval: 5 * 1000, punishment: "ban", duration: 0 },
    badword: { limit: 1, interval: 0, punishment: "timeout", duration: 15 * MIN },
  },
  maximum: {
    spam: { limit: 3, interval: 3 * 1000, punishment: "kick", duration: 0 },
    mentions: { limit: 3, interval: 2 * 1000, punishment: "kick", duration: 0 },
    links: { limit: 1, interval: 5 * 1000, punishment: "timeout", duration: 6 * HOUR },
    emojis: { limit: 5, interval: 2 * 1000, punishment: "kick", duration: 0 },
    joins: { limit: 3, interval: 10 * 1000, punishment: "ban", duration: 0 },
    bots: { limit: 1, interval: 10 * 1000, punishment: "ban", duration: 0 },
    nuke: { limit: 1, interval: 3 * 1000, punishment: "ban", duration: 0, channelThreshold: 1, roleThreshold: 1, webhookThreshold: 1 },
    selfbots: { limit: 1, interval: 3 * 1000, punishment: "ban", duration: 0 },
    badword: { limit: 1, interval: 0, punishment: "kick", duration: 0 },
  },
}

export interface AntiRaidConfig {
  guildId: string
  enabled: boolean
  mode: AntiRaidMode
  raidMode: boolean
  raidEndsAt: number
  raidDuration: number
  logChannel: string | null
  whitelistedUsers: string[]
  whitelistedRoles: string[]
  whitelistedBots: string[]
  whitelistedChannels: string[]
  honeypot: HoneypotSettings
  quarantine: QuarantineSettings
  lockdown: LockdownSettings
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
    maxUserMentions: { type: Number, default: 5 },
    maxRoleMentions: { type: Number, default: 2 },
    allowEveryone: { type: Boolean, default: false },
    blockDiscordInvites: { type: Boolean, default: true },
    allowedDomains: { type: [String], default: [] },
    blockedDomains: { type: [String], default: [] },
    bannedWords: { type: [String], default: [] },
    channelThreshold: { type: Number, default: 3 },
    roleThreshold: { type: Number, default: 3 },
    webhookThreshold: { type: Number, default: 3 },
    custom: { type: Boolean, default: false },
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
    badword: { type: moduleSchema, default: () => ({ ...MODULE_DEFAULTS.badword }) },
  },
  { _id: false }
)

const honeypotSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    channels: { type: [String], default: [] },
    roles: { type: [String], default: [] },
    punishment: { type: String, enum: PUNISHMENTS, default: "ban" },
    duration: { type: Number, default: 0 },
  },
  { _id: false }
)

const quarantineSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    role: { type: String, default: null },
    users: { type: [String], default: [] },
  },
  { _id: false }
)

const lockdownSchema = new Schema(
  {
    slowmode: { type: Number, default: 0 },
    blockJoins: { type: Boolean, default: false },
    blockMessages: { type: Boolean, default: true },
  },
  { _id: false }
)

const antiRaidSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: false },
    mode: { type: String, enum: MODES, default: "balanced" },
    raidMode: { type: Boolean, default: false },
    raidEndsAt: { type: Number, default: 0 },
    raidDuration: { type: Number, default: HOUR },
    logChannel: { type: String, default: null },
    whitelistedUsers: { type: [String], default: [] },
    whitelistedRoles: { type: [String], default: [] },
    whitelistedBots: { type: [String], default: [] },
    whitelistedChannels: { type: [String], default: [] },
    honeypot: { type: honeypotSchema, default: () => ({}) },
    quarantine: { type: quarantineSchema, default: () => ({}) },
    lockdown: { type: lockdownSchema, default: () => ({}) },
    modules: { type: modulesSchema, default: () => ({}) },
  },
  { timestamps: true }
)

applyBotScope(antiRaidSchema)
uniqueBotGuildIndex(antiRaidSchema)

export const AntiRaid = model("AntiRaid", antiRaidSchema, "antiraid")

export const HONEYPOT_DEFAULTS: HoneypotSettings = {
  enabled: false,
  channels: [],
  roles: [],
  punishment: "ban",
  duration: 0,
}

export const QUARANTINE_DEFAULTS: QuarantineSettings = {
  enabled: false,
  role: null,
  users: [],
}

export const LOCKDOWN_DEFAULTS: LockdownSettings = {
  slowmode: 0,
  blockJoins: false,
  blockMessages: true,
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : fallback
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): AntiRaidConfig {
  const modules = (raw?.modules as Record<string, Partial<ModuleSettings>> | undefined) ?? {}
  const normalizedModules = {} as Record<ModuleName, ModuleSettings>

  for (const name of MODULES) {
    const base = MODULE_DEFAULTS[name]
    const value = modules[name] ?? {}
    normalizedModules[name] = {
      enabled: asBoolean(value.enabled, base.enabled),
      limit: asNumber(value.limit, base.limit),
      interval: asNumber(value.interval, base.interval),
      punishment: PUNISHMENTS.includes(value.punishment as Punishment) ? (value.punishment as Punishment) : base.punishment,
      duration: asNumber(value.duration, base.duration),
      maxAge: asNumber(value.maxAge, base.maxAge),
      role: typeof value.role === "string" ? value.role : base.role,
      maxUserMentions: asNumber(value.maxUserMentions, base.maxUserMentions),
      maxRoleMentions: asNumber(value.maxRoleMentions, base.maxRoleMentions),
      allowEveryone: asBoolean(value.allowEveryone, base.allowEveryone),
      blockDiscordInvites: asBoolean(value.blockDiscordInvites, base.blockDiscordInvites),
      allowedDomains: asStringArray(value.allowedDomains, base.allowedDomains),
      blockedDomains: asStringArray(value.blockedDomains, base.blockedDomains),
      bannedWords: asStringArray(value.bannedWords, base.bannedWords),
      channelThreshold: asNumber(value.channelThreshold, base.channelThreshold),
      roleThreshold: asNumber(value.roleThreshold, base.roleThreshold),
      webhookThreshold: asNumber(value.webhookThreshold, base.webhookThreshold),
      custom: asBoolean(value.custom, base.custom),
    }
  }

  const rawHoneypot = raw?.honeypot as Record<string, unknown> | undefined
  const rawQuarantine = raw?.quarantine as Record<string, unknown> | undefined
  const rawLockdown = raw?.lockdown as Record<string, unknown> | undefined

  const honeypot: HoneypotSettings = {
    enabled: asBoolean(rawHoneypot?.enabled, HONEYPOT_DEFAULTS.enabled),
    channels: asStringArray(rawHoneypot?.channels, HONEYPOT_DEFAULTS.channels),
    roles: asStringArray(rawHoneypot?.roles, HONEYPOT_DEFAULTS.roles),
    punishment: PUNISHMENTS.includes(rawHoneypot?.punishment as Punishment) ? (rawHoneypot?.punishment as Punishment) : HONEYPOT_DEFAULTS.punishment,
    duration: asNumber(rawHoneypot?.duration, HONEYPOT_DEFAULTS.duration),
  }

  const quarantine: QuarantineSettings = {
    enabled: asBoolean(rawQuarantine?.enabled, QUARANTINE_DEFAULTS.enabled),
    role: typeof rawQuarantine?.role === "string" ? rawQuarantine.role : QUARANTINE_DEFAULTS.role,
    users: asStringArray(rawQuarantine?.users, QUARANTINE_DEFAULTS.users),
  }

  const lockdown: LockdownSettings = {
    slowmode: asNumber(rawLockdown?.slowmode, LOCKDOWN_DEFAULTS.slowmode),
    blockJoins: asBoolean(rawLockdown?.blockJoins, LOCKDOWN_DEFAULTS.blockJoins),
    blockMessages: asBoolean(rawLockdown?.blockMessages, LOCKDOWN_DEFAULTS.blockMessages),
  }

  return {
    guildId: typeof raw?.guildId === "string" ? raw.guildId : "",
    enabled: asBoolean(raw?.enabled, false),
    mode: MODES.includes(raw?.mode as AntiRaidMode) ? (raw?.mode as AntiRaidMode) : "balanced",
    raidMode: asBoolean(raw?.raidMode, false),
    raidEndsAt: asNumber(raw?.raidEndsAt, 0),
    raidDuration: asNumber(raw?.raidDuration, HOUR),
    logChannel: typeof raw?.logChannel === "string" ? raw.logChannel : null,
    whitelistedUsers: asStringArray(raw?.whitelistedUsers, []),
    whitelistedRoles: asStringArray(raw?.whitelistedRoles, []),
    whitelistedBots: asStringArray(raw?.whitelistedBots, []),
    whitelistedChannels: asStringArray(raw?.whitelistedChannels, []),
    honeypot,
    quarantine,
    lockdown,
    modules: normalizedModules,
  }
}

export async function getConfig(guildId: string): Promise<AntiRaidConfig> {
  const raw = await AntiRaid.findOne({ guildId }).lean()
  return normalizeConfig(raw ?? null)
}
