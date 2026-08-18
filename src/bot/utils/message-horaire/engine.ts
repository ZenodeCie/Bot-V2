import {
  EmbedBuilder,
  type Client,
  type ColorResolvable,
  type GuildTextBasedChannel,
  type MessageCreateOptions,
} from "discord.js"
import { colors } from "../../config.js"
import {
  MAX_JOBS,
  MessageHoraireJobModel,
  clampContent,
  clampInterval,
  countJobs,
  createJobRecord,
  deleteJob,
  getJob,
  hasSendablePayload,
  listDueJobs,
  listEnabledJobsAll,
  normalizeJob,
  parseOptionalColor,
  updateJob,
  type JobEmbed,
  type MessageHoraireJob,
} from "./schema.js"

const MAX_TIMEOUT = 2_147_483_647
const SWEEP_INTERVAL = 60_000

export type JobActionResult = { ok: true; job: MessageHoraireJob } | { ok: false; error: string }

export interface CreateJobInput {
  client: Client
  guildId: string
  channel: GuildTextBasedChannel
  interval: number
  content: string
  embed?: JobEmbed
}

const timers = new Map<string, NodeJS.Timeout>()
let sweepStarted = false

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

export function buildJobPayload(job: MessageHoraireJob): MessageCreateOptions | null {
  if (!hasSendablePayload(job)) return null
  const payload: MessageCreateOptions = { allowedMentions: { parse: [] } }
  if (job.content.trim()) payload.content = clip(job.content.trim(), 2000)
  if (job.embed.enabled) {
    const title = job.embed.title.trim()
    const description = job.embed.description.trim()
    if (title || description) {
      const embed = new EmbedBuilder()
      if (title) embed.setTitle(clip(title, 256))
      if (description) embed.setDescription(clip(description, 4096))
      const color = parseOptionalColor(job.embed.color) ?? colors.prime
      if (color) embed.setColor(color as ColorResolvable)
      payload.embeds = [embed]
    }
  }
  if (!payload.content && !payload.embeds) return null
  return payload
}

async function resolveTextChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null
  return channel
}

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (!timer) return
  clearTimeout(timer)
  timers.delete(id)
}

export function scheduleMessageHoraire(client: Client, id: string, nextAt: number): void {
  clearTimer(id)
  const delay = nextAt - Date.now()
  if (delay <= 0) {
    void sendDueJob(client, id).catch((error) => console.error(`Failed to send scheduled message ${id}:`, error))
    return
  }
  const timer = setTimeout(() => {
    timers.delete(id)
    if (Date.now() < nextAt) {
      scheduleMessageHoraire(client, id, nextAt)
      return
    }
    void sendDueJob(client, id).catch((error) => console.error(`Failed to send scheduled message ${id}:`, error))
  }, Math.min(delay, MAX_TIMEOUT))
  timers.set(id, timer)
}

export async function rescheduleJob(client: Client, id: string): Promise<void> {
  const job = await getJob(id)
  if (!job || !job.enabled) {
    clearTimer(id)
    return
  }
  scheduleMessageHoraire(client, id, job.nextAt)
}

async function disableJob(id: string, reason: string): Promise<void> {
  clearTimer(id)
  await updateJob(id, { $set: { enabled: false } })
  console.error(`Message-Horaire: job ${id} désactivé (${reason})`)
}

export async function sendDueJob(client: Client, id: string): Promise<JobActionResult> {
  const current = await getJob(id)
  if (!current) return { ok: false, error: "> *Message horaire introuvable.*" }
  if (!current.enabled) {
    clearTimer(id)
    return { ok: false, error: "> *Ce message horaire est désactivé.*" }
  }

  const reserved = await MessageHoraireJobModel.findOneAndUpdate(
    { _id: id, enabled: true, nextAt: { $lte: Date.now() } },
    { $set: { nextAt: Date.now() + current.interval } },
    { new: true }
  ).lean()
  const job = normalizeJob(reserved as Record<string, unknown> | null)

  if (!job) {
    const fresh = await getJob(id)
    if (fresh?.enabled) scheduleMessageHoraire(client, id, fresh.nextAt)
    return { ok: false, error: "> *Ce message horaire n'est pas encore dû.*" }
  }

  const channel = await resolveTextChannel(client, job.channelId)
  if (!channel) {
    await disableJob(id, "salon inaccessible")
    return { ok: false, error: "> *Salon inaccessible. Le message horaire a été **désactivé**.*" }
  }

  const payload = buildJobPayload(job)
  if (payload) {
    const sent = await channel.send(payload).catch((error: unknown) => {
      console.error(`Failed to send scheduled message ${id} in guild ${job.guildId}:`, error)
      return null
    })
    if (!sent) {
      await disableJob(id, "envoi impossible")
      return { ok: false, error: "> *Impossible d'envoyer le message. Le job a été **désactivé**.*" }
    }
  } else {
    console.error(`Message-Horaire: job ${id} sans contenu, envoi ignoré`)
  }

  if (job.enabled) scheduleMessageHoraire(client, id, job.nextAt)
  return { ok: true, job }
}

export async function createJob(input: CreateJobInput): Promise<JobActionResult> {
  const content = clampContent(input.content)
  const embed = input.embed
  if (!hasSendablePayload({ content, embed: embed ?? { enabled: false, title: "", description: "", color: null } })) {
    return { ok: false, error: "> *Indiquez un message ou un embed.*" }
  }
  const total = await countJobs(input.guildId)
  if (total >= MAX_JOBS) {
    return { ok: false, error: `> *Limite atteinte : **${MAX_JOBS}** messages horaires par serveur.*` }
  }
  const interval = clampInterval(input.interval)
  const job = await createJobRecord({
    guildId: input.guildId,
    channelId: input.channel.id,
    interval,
    content,
    embed,
  })
  if (!job) return { ok: false, error: "> *Impossible de créer le message horaire.*" }
  scheduleMessageHoraire(input.client, job.id, job.nextAt)
  return { ok: true, job }
}

export async function setJobEnabled(client: Client, id: string, enabled: boolean): Promise<JobActionResult> {
  const current = await getJob(id)
  if (!current) return { ok: false, error: "> *Message horaire introuvable.*" }
  const nextAt = enabled ? Math.max(current.nextAt, Date.now() + current.interval) : current.nextAt
  const job = await updateJob(id, { $set: { enabled, nextAt } })
  if (!job) return { ok: false, error: "> *Message horaire introuvable.*" }
  if (job.enabled) scheduleMessageHoraire(client, job.id, job.nextAt)
  else clearTimer(id)
  return { ok: true, job }
}

export async function removeJob(id: string): Promise<JobActionResult> {
  const current = await getJob(id)
  if (!current) return { ok: false, error: "> *Message horaire introuvable.*" }
  clearTimer(id)
  await deleteJob(id)
  return { ok: true, job: current }
}

export async function initMessageHoraire(client: Client): Promise<void> {
  const jobs = await listEnabledJobsAll()
  let overdue = 0
  for (const job of jobs) {
    scheduleMessageHoraire(client, job.id, job.nextAt)
    if (job.nextAt <= Date.now()) overdue++
  }
  console.log(`Message-Horaire: ${jobs.length} message(s) restauré(s) après redémarrage (${overdue} déjà dû(s)).`)
}

export function startMessageHoraireSweep(client: Client): void {
  if (sweepStarted) return
  sweepStarted = true
  setInterval(() => {
    void sweepDueJobs(client).catch((error) => console.error("Message-Horaire sweep failed:", error))
  }, SWEEP_INTERVAL)
}

export async function sweepDueJobs(client: Client): Promise<void> {
  const due = await listDueJobs()
  for (const job of due) {
    await sendDueJob(client, job.id).catch((error) => console.error(error))
  }
}
