import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"

export const MEDIA_SOURCES = ["none", "avatar", "server", "url"] as const
export type MediaSource = (typeof MEDIA_SOURCES)[number]

export const FOOTER_ICONS = ["none", "avatar", "server"] as const
export type FooterIcon = (typeof FOOTER_ICONS)[number]

export const TEMPLATE_TARGETS = ["arrival", "departure", "dm"] as const
export type TemplateTarget = (typeof TEMPLATE_TARGETS)[number]

export const VIEWS = ["home", "arrival", "departure", "dm", "autoroles"] as const
export type AeroportView = (typeof VIEWS)[number]

export const MEDIA_SOURCE_LABELS: Record<MediaSource, string> = {
  none: "Aucun",
  avatar: "Avatar du membre",
  server: "Icône du serveur",
  url: "URL personnalisée",
}

export const FOOTER_ICON_LABELS: Record<FooterIcon, string> = {
  none: "Aucune",
  avatar: "Avatar du membre",
  server: "Icône du serveur",
}

export const TARGET_LABELS: Record<TemplateTarget, string> = {
  arrival: "Arrivée",
  departure: "Départ",
  dm: "Message privé",
}

export interface EmbedSettings {
  enabled: boolean
  title: string
  description: string
  color: string | null
  thumbnail: MediaSource
  thumbnailUrl: string | null
  image: MediaSource
  imageUrl: string | null
  footer: string
  footerIcon: FooterIcon
  author: boolean
  timestamp: boolean
}

export interface MessageTemplate {
  content: string
  embed: EmbedSettings
}

export interface FlightSettings {
  enabled: boolean
  channelId: string | null
  template: MessageTemplate
}

export interface DmSettings {
  enabled: boolean
  template: MessageTemplate
}

export interface AeroportConfig {
  guildId: string
  ignoreBots: boolean
  arrival: FlightSettings
  departure: FlightSettings
  dm: DmSettings
  autoroles: string[]
}

function embedBase(overrides: Partial<EmbedSettings> = {}): EmbedSettings {
  return {
    enabled: true,
    title: "",
    description: "",
    color: null,
    thumbnail: "none",
    thumbnailUrl: null,
    image: "none",
    imageUrl: null,
    footer: "",
    footerIcon: "none",
    author: false,
    timestamp: false,
    ...overrides,
  }
}

function templateBase(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    content: overrides.content ?? "",
    embed: embedBase(overrides.embed),
  }
}

export const ARRIVAL_DEFAULT: FlightSettings = {
  enabled: false,
  channelId: null,
  template: templateBase({
    content: "{user}",
    embed: embedBase({
      title: "Atterrissage",
      description: "{user} vient d'atterrir sur **{server}**.\nNous sommes maintenant **{memberCount}** membres.",
      thumbnail: "avatar",
      footer: "{server}",
      footerIcon: "server",
      timestamp: true,
    }),
  }),
}

export const DEPARTURE_DEFAULT: FlightSettings = {
  enabled: false,
  channelId: null,
  template: templateBase({
    content: "",
    embed: embedBase({
      title: "Décollage",
      description: "**{user.name}** a quitté **{server}**.\nIl reste **{memberCount}** membres.",
      thumbnail: "avatar",
      footer: "{server}",
      footerIcon: "server",
      timestamp: true,
    }),
  }),
}

export const DM_DEFAULT: DmSettings = {
  enabled: false,
  template: templateBase({
    content: "",
    embed: embedBase({
      title: "Bienvenue sur {server}",
      description: "Salut {user.name} ! Merci d'avoir rejoint **{server}**.",
      thumbnail: "server",
      timestamp: true,
    }),
  }),
}

export function defaultConfig(guildId: string): AeroportConfig {
  return {
    guildId,
    ignoreBots: true,
    arrival: structuredClone(ARRIVAL_DEFAULT),
    departure: structuredClone(DEPARTURE_DEFAULT),
    dm: structuredClone(DM_DEFAULT),
    autoroles: [],
  }
}

const embedSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    color: { type: String, default: null },
    thumbnail: { type: String, enum: MEDIA_SOURCES, default: "none" },
    thumbnailUrl: { type: String, default: null },
    image: { type: String, enum: MEDIA_SOURCES, default: "none" },
    imageUrl: { type: String, default: null },
    footer: { type: String, default: "" },
    footerIcon: { type: String, enum: FOOTER_ICONS, default: "none" },
    author: { type: Boolean, default: false },
    timestamp: { type: Boolean, default: false },
  },
  { _id: false }
)

const templateSchema = new Schema(
  {
    content: { type: String, default: "" },
    embed: { type: embedSchema, default: () => ({}) },
  },
  { _id: false }
)

const flightSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    template: { type: templateSchema, default: () => ({}) },
  },
  { _id: false }
)

const dmSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    template: { type: templateSchema, default: () => ({}) },
  },
  { _id: false }
)

const aeroportSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    ignoreBots: { type: Boolean, default: true },
    arrival: { type: flightSchema, default: () => structuredClone(ARRIVAL_DEFAULT) },
    departure: { type: flightSchema, default: () => structuredClone(DEPARTURE_DEFAULT) },
    dm: { type: dmSchema, default: () => structuredClone(DM_DEFAULT) },
    autoroles: { type: [String], default: [] },
  },
  { timestamps: true }
)

applyBotScope(aeroportSchema)
uniqueBotGuildIndex(aeroportSchema)

export const Aeroport = model("Aeroport", aeroportSchema, "aeroport")

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

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : fallback
}

function asMediaSource(value: unknown, fallback: MediaSource): MediaSource {
  return MEDIA_SOURCES.includes(value as MediaSource) ? (value as MediaSource) : fallback
}

function asFooterIcon(value: unknown, fallback: FooterIcon): FooterIcon {
  return FOOTER_ICONS.includes(value as FooterIcon) ? (value as FooterIcon) : fallback
}

function normalizeEmbed(raw: Record<string, unknown> | null | undefined, fallback: EmbedSettings): EmbedSettings {
  const value = raw ?? {}
  return {
    enabled: asBoolean(value.enabled, fallback.enabled),
    title: asString(value.title, fallback.title),
    description: asString(value.description, fallback.description),
    color: asStringOrNull(value.color, fallback.color),
    thumbnail: asMediaSource(value.thumbnail, fallback.thumbnail),
    thumbnailUrl: asStringOrNull(value.thumbnailUrl, fallback.thumbnailUrl),
    image: asMediaSource(value.image, fallback.image),
    imageUrl: asStringOrNull(value.imageUrl, fallback.imageUrl),
    footer: asString(value.footer, fallback.footer),
    footerIcon: asFooterIcon(value.footerIcon, fallback.footerIcon),
    author: asBoolean(value.author, fallback.author),
    timestamp: asBoolean(value.timestamp, fallback.timestamp),
  }
}

function normalizeTemplate(raw: Record<string, unknown> | null | undefined, fallback: MessageTemplate): MessageTemplate {
  const value = raw ?? {}
  return {
    content: asString(value.content, fallback.content),
    embed: normalizeEmbed(value.embed as Record<string, unknown> | undefined, fallback.embed),
  }
}

function normalizeFlight(raw: Record<string, unknown> | null | undefined, fallback: FlightSettings): FlightSettings {
  const value = raw ?? {}
  return {
    enabled: asBoolean(value.enabled, fallback.enabled),
    channelId: asStringOrNull(value.channelId, fallback.channelId),
    template: normalizeTemplate(value.template as Record<string, unknown> | undefined, fallback.template),
  }
}

function normalizeDm(raw: Record<string, unknown> | null | undefined, fallback: DmSettings): DmSettings {
  const value = raw ?? {}
  return {
    enabled: asBoolean(value.enabled, fallback.enabled),
    template: normalizeTemplate(value.template as Record<string, unknown> | undefined, fallback.template),
  }
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): AeroportConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  return {
    guildId,
    ignoreBots: asBoolean(raw?.ignoreBots, defaults.ignoreBots),
    arrival: normalizeFlight(raw?.arrival as Record<string, unknown> | undefined, defaults.arrival),
    departure: normalizeFlight(raw?.departure as Record<string, unknown> | undefined, defaults.departure),
    dm: normalizeDm(raw?.dm as Record<string, unknown> | undefined, defaults.dm),
    autoroles: asStringArray(raw?.autoroles, defaults.autoroles),
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: AeroportConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<AeroportConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await Aeroport.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(
  guildId: string,
  update: Record<string, unknown>
): Promise<AeroportConfig> {
  await Aeroport.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export function getTemplate(config: AeroportConfig, target: TemplateTarget): MessageTemplate {
  return target === "dm" ? config.dm.template : config[target].template
}
