import { Schema, model } from "mongoose"

export const MIN_INTERVAL = 60 * 1000
export const MAX_INTERVAL = 30 * 24 * 60 * 60 * 1000
export const MAX_JOBS = 10
export const MAX_CONTENT_LENGTH = 2000
export const MAX_TITLE_LENGTH = 256
export const MAX_DESCRIPTION_LENGTH = 4096

export interface MessageHoraireConfig {
  guildId: string
  defaultChannelId: string | null
}

export interface JobEmbed {
  enabled: boolean
  title: string
  description: string
  color: string | null
}

export interface MessageHoraireJob {
  id: string
  guildId: string
  channelId: string
  enabled: boolean
  interval: number
  nextAt: number
  content: string
  embed: JobEmbed
}

export function defaultConfig(guildId: string): MessageHoraireConfig {
  return {
    guildId,
    defaultChannelId: null,
  }
}

export function defaultEmbed(): JobEmbed {
  return {
    enabled: false,
    title: "",
    description: "",
    color: null,
  }
}

const configSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    defaultChannelId: { type: String, default: null },
  },
  { timestamps: true }
)

export const MessageHoraireConfigModel = model("MessageHoraireConfig", configSchema, "messagehoraire")

const embedSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    color: { type: String, default: null },
  },
  { _id: false }
)

const jobSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    enabled: { type: Boolean, default: true, index: true },
    interval: { type: Number, required: true },
    nextAt: { type: Number, required: true, index: true },
    content: { type: String, default: "" },
    embed: { type: embedSchema, default: () => defaultEmbed() },
  },
  { timestamps: true }
)

jobSchema.index({ guildId: 1, enabled: 1 })
jobSchema.index({ enabled: 1, nextAt: 1 })

export const MessageHoraireJobModel = model("MessageHoraireJob", jobSchema, "messagehoraires")

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

export function clampContent(value: string): string {
  return value.trim().slice(0, MAX_CONTENT_LENGTH)
}

export function clampTitle(value: string): string {
  return value.trim().slice(0, MAX_TITLE_LENGTH)
}

export function clampDescription(value: string): string {
  return value.trim().slice(0, MAX_DESCRIPTION_LENGTH)
}

export function isJobId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value)
}

export function parseOptionalColor(value: string | null | undefined): `#${string}` | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed as `#${string}`
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}` as `#${string}`
  return null
}

function normalizeEmbed(raw: Record<string, unknown> | null | undefined): JobEmbed {
  const defaults = defaultEmbed()
  const value = raw ?? {}
  return {
    enabled: asBoolean(value.enabled, defaults.enabled),
    title: clampTitle(asString(value.title, defaults.title)),
    description: clampDescription(asString(value.description, defaults.description)),
    color: asStringOrNull(value.color, defaults.color),
  }
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): MessageHoraireConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  return {
    guildId,
    defaultChannelId: asStringOrNull(raw?.defaultChannelId, defaults.defaultChannelId),
  }
}

export function normalizeJob(raw: Record<string, unknown> | null | undefined): MessageHoraireJob | null {
  if (!raw) return null
  const id = raw.id ?? raw._id
  const idStr = typeof id === "string" ? id : id != null ? String(id) : ""
  if (!idStr) return null
  return {
    id: idStr,
    guildId: asString(raw.guildId, ""),
    channelId: asString(raw.channelId, ""),
    enabled: asBoolean(raw.enabled, true),
    interval: clampInterval(asNumber(raw.interval, MIN_INTERVAL)),
    nextAt: asNumber(raw.nextAt, 0),
    content: clampContent(asString(raw.content, "")),
    embed: normalizeEmbed(raw.embed as Record<string, unknown> | undefined),
  }
}

export function hasSendablePayload(job: Pick<MessageHoraireJob, "content" | "embed">): boolean {
  if (job.content.trim()) return true
  if (!job.embed.enabled) return false
  return job.embed.title.trim().length > 0 || job.embed.description.trim().length > 0
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: MessageHoraireConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<MessageHoraireConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await MessageHoraireConfigModel.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<MessageHoraireConfig> {
  await MessageHoraireConfigModel.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export async function getJob(id: string): Promise<MessageHoraireJob | null> {
  if (!isJobId(id)) return null
  const raw = await MessageHoraireJobModel.findById(id).lean()
  return normalizeJob(raw as Record<string, unknown> | null)
}

export async function countJobs(guildId: string): Promise<number> {
  return MessageHoraireJobModel.countDocuments({ guildId })
}

export async function listJobs(guildId: string, limit = MAX_JOBS): Promise<MessageHoraireJob[]> {
  const docs = await MessageHoraireJobModel.find({ guildId }).sort({ nextAt: 1 }).limit(limit).lean()
  return docs
    .map((doc) => normalizeJob(doc as Record<string, unknown>))
    .filter((doc): doc is MessageHoraireJob => doc !== null)
}

export async function listEnabledJobsAll(): Promise<MessageHoraireJob[]> {
  const docs = await MessageHoraireJobModel.find({ enabled: true }).lean()
  return docs
    .map((doc) => normalizeJob(doc as Record<string, unknown>))
    .filter((doc): doc is MessageHoraireJob => doc !== null)
}

export async function listDueJobs(): Promise<MessageHoraireJob[]> {
  const docs = await MessageHoraireJobModel.find({ enabled: true, nextAt: { $lte: Date.now() } }).lean()
  return docs
    .map((doc) => normalizeJob(doc as Record<string, unknown>))
    .filter((doc): doc is MessageHoraireJob => doc !== null)
}

export async function createJobRecord(input: {
  guildId: string
  channelId: string
  interval: number
  content: string
  embed?: JobEmbed
}): Promise<MessageHoraireJob | null> {
  const created = await MessageHoraireJobModel.create({
    guildId: input.guildId,
    channelId: input.channelId,
    enabled: true,
    interval: clampInterval(input.interval),
    nextAt: Date.now() + clampInterval(input.interval),
    content: clampContent(input.content),
    embed: input.embed ?? defaultEmbed(),
  })
  return normalizeJob(created.toObject() as Record<string, unknown>)
}

export async function updateJob(id: string, update: Record<string, unknown>): Promise<MessageHoraireJob | null> {
  const raw = await MessageHoraireJobModel.findByIdAndUpdate(id, update, { new: true }).lean()
  return normalizeJob(raw as Record<string, unknown> | null)
}

export async function deleteJob(id: string): Promise<boolean> {
  const result = await MessageHoraireJobModel.deleteOne({ _id: id })
  return result.deletedCount === 1
}
