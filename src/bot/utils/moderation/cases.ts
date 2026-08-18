import { EmbedBuilder, type Client, type ColorResolvable, type Guild, type User } from "discord.js"
import formatTime from "../formatTime.js"
import { formatDate } from "./helpers.js"
import {
  ACTION_EMOJIS,
  ACTION_LABELS,
  STATUS_LABELS,
  ModCase,
  formatCaseId,
  getModerationConfig,
  nextCaseId,
  type CaseStatus,
  type ModAction,
  type ModCaseDoc,
} from "./schema.js"

export interface CaseTarget {
  id: string
  username: string
  globalName: string | null
}

export interface CaseActor {
  id: string
  username: string
}

export interface CaseChannel {
  id: string
  name: string
}

export interface CreateCaseInput {
  guild: Guild
  target: CaseTarget | null
  moderator: CaseActor | null
  action: ModAction
  reason: string
  duration?: number | null
  endAt?: number | null
  status?: CaseStatus
  error?: string | null
  linkedCaseId?: number | null
  channel?: CaseChannel | null
  metadata?: Record<string, unknown>
}

export async function createCase(input: CreateCaseInput): Promise<ModCaseDoc> {
  const caseId = await nextCaseId(input.guild.id)
  const doc = await ModCase.create({
    caseId,
    caseIdFormatted: formatCaseId(caseId),
    guildId: input.guild.id,
    guildName: input.guild.name,
    userId: input.target?.id ?? null,
    username: input.target?.username ?? "Inconnu",
    globalName: input.target?.globalName ?? null,
    moderatorId: input.moderator?.id ?? null,
    moderatorUsername: input.moderator?.username ?? "Automatique",
    channelId: input.channel?.id ?? null,
    channelName: input.channel?.name ?? null,
    action: input.action,
    reason: input.reason || "Aucune raison fournie",
    duration: input.duration ?? null,
    startedAt: Date.now(),
    endAt: input.endAt ?? null,
    status: input.status ?? "SUCCESS",
    error: input.error ?? null,
    linkedCaseId: input.linkedCaseId ?? null,
    linkedCaseIdFormatted: input.linkedCaseId ? formatCaseId(input.linkedCaseId) : null,
    dmStatus: "none",
    dmError: null,
    metadata: input.metadata ?? {},
  })
  return doc.toObject() as ModCaseDoc
}

export async function updateCaseDm(c: ModCaseDoc, dm: { status: "sent" | "failed"; error?: string }): Promise<void> {
  await ModCase.updateOne(
    { guildId: c.guildId, caseId: c.caseId },
    { $set: { dmStatus: dm.status, dmError: dm.error ?? null } }
  )
}

export type DmResult = { status: "sent" | "failed"; error?: string }

export async function notifyUser(
  user: User,
  guildName: string,
  actionLabel: string,
  reason: string,
  duration: number | null,
  caseIdFormatted: string
): Promise<DmResult> {
  const embed = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(
      `# \`⚠️\` 〃 Sanction\n` +
        `> *Vous avez été sanctionné(e) sur **${guildName}**.*\n` +
        `> ***Action :** ${actionLabel}*\n` +
        `> ***Raison :** ${reason}*\n` +
        (duration ? `> ***Durée :** ${formatTime(duration)}\n` : "") +
        `> ***Case :** ${caseIdFormatted}*`
    )
    .setColor("#E82C20")
  try {
    await user.send({ embeds: [embed] })
    return { status: "sent" }
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) }
  }
}

const STATUS_COLORS: Record<CaseStatus, ColorResolvable> = {
  SUCCESS: "#2ECC71",
  FAILED: "#E82C20",
  REVOKED: "#F39C12",
  EXPIRED: "#95A5A6",
  CANCELLED: "#95A5A6",
  DENIED: "#E67E22",
}

export function buildCaseLogEmbed(c: ModCaseDoc): EmbedBuilder {
  const failed = c.status === "FAILED" || c.status === "DENIED"
  const emoji = failed ? "❌" : ACTION_EMOJIS[c.action]
  const embed = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(`# \`${emoji}\` 〃 ${ACTION_LABELS[c.action]}`)
    .setColor(STATUS_COLORS[c.status])

  embed.addFields(
    { name: "Utilisateur", value: `${c.username}\nID : ${c.userId ?? "—"}`, inline: true },
    { name: "Modérateur", value: `${c.moderatorUsername}\nID : ${c.moderatorId ?? "—"}`, inline: true },
    { name: "Raison", value: c.reason, inline: false },
    { name: "Durée", value: c.duration ? formatTime(c.duration) : "Permanente", inline: true },
    { name: "Case", value: c.caseIdFormatted, inline: true },
    {
      name: "Date",
      value: `${formatDate(c.startedAt)}\n<t:${Math.floor(c.startedAt / 1000)}:R>`,
      inline: true,
    }
  )
  if (c.endAt) {
    embed.addFields({
      name: "Expiration",
      value: `${formatDate(c.endAt)}\n<t:${Math.floor(c.endAt / 1000)}:R>`,
      inline: true,
    })
  }
  if (c.linkedCaseIdFormatted) {
    embed.addFields({ name: "Case liée", value: c.linkedCaseIdFormatted, inline: true })
  }
  if (c.channelName) {
    embed.addFields({ name: "Salon", value: c.channelName, inline: true })
  }
  if (c.error) {
    embed.addFields({ name: "Erreur", value: `\`\`\`\n${c.error}\n\`\`\``, inline: false })
  }
  embed.addFields({ name: "Statut", value: STATUS_LABELS[c.status], inline: true })
  if (c.dmStatus === "sent") {
    embed.addFields({ name: "DM", value: "Envoyé", inline: true })
  }
  if (c.dmStatus === "failed") {
    embed.addFields({ name: "DM", value: `Échec (${c.dmError ?? "inconnu"})`, inline: true })
  }
  embed.setFooter({ text: `Guild : ${c.guildName}` })
  return embed
}

export async function logModCase(client: Client, c: ModCaseDoc): Promise<void> {
  try {
    const config = await getModerationConfig(c.guildId)
    if (!config.logChannelId) return
    const channel = client.channels.cache.get(config.logChannelId)
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return
    await channel.send({ embeds: [buildCaseLogEmbed(c)] })
  } catch (error) {
    console.error(`Failed to send moderation log for case ${c.caseIdFormatted}:`, error)
  }
}

export async function logModEvent(client: Client, guildId: string, embed: EmbedBuilder): Promise<void> {
  try {
    const config = await getModerationConfig(guildId)
    if (!config.logChannelId) return
    const channel = client.channels.cache.get(config.logChannelId)
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return
    await channel.send({ embeds: [embed] })
  } catch (error) {
    console.error("Failed to send moderation event log:", error)
  }
}

export interface AttemptContext {
  guild: Guild
  target: CaseTarget | null
  moderator: CaseActor
  action: ModAction
  reason: string
}

export async function recordDenied(client: Client, ctx: AttemptContext, error: string): Promise<void> {
  const c = await createCase({
    guild: ctx.guild,
    target: ctx.target,
    moderator: ctx.moderator,
    action: ctx.action,
    reason: ctx.reason,
    status: "DENIED",
    error,
  })
  await logModCase(client, c)
  console.log(
    `Moderation denied: ${ctx.action} on ${ctx.target?.id ?? "unknown"} by ${ctx.moderator.id} in ${ctx.guild.id}: ${error}`
  )
}

export async function recordFailed(client: Client, ctx: AttemptContext, error: string): Promise<void> {
  const c = await createCase({
    guild: ctx.guild,
    target: ctx.target,
    moderator: ctx.moderator,
    action: ctx.action,
    reason: ctx.reason,
    status: "FAILED",
    error,
  })
  await logModCase(client, c)
  console.error(
    `Moderation failed: ${ctx.action} on ${ctx.target?.id ?? "unknown"} by ${ctx.moderator.id} in ${ctx.guild.id}: ${error}`
  )
}

const ACTIVE_ACTIONS: Record<"ban" | "timeout" | "mute" | "lock", ModAction[]> = {
  ban: ["BAN", "TEMPBAN", "SOFTBAN"],
  timeout: ["TIMEOUT"],
  mute: ["MUTE", "TEMPMUTE"],
  lock: ["LOCK"],
}

export async function findActiveCase(
  guildId: string,
  kind: "ban" | "timeout" | "mute" | "lock",
  userId?: string,
  channelId?: string
): Promise<ModCaseDoc | null> {
  if (kind === "lock" && !channelId) return null
  if (kind !== "lock" && !userId) return null
  const filter: Record<string, unknown> = { guildId, action: { $in: ACTIVE_ACTIONS[kind] }, status: "SUCCESS" }
  if (kind === "timeout") {
    filter.$or = [{ endAt: null }, { endAt: { $gt: Date.now() } }]
  }
  if (kind === "lock") {
    filter.channelId = channelId
  } else {
    filter.userId = userId
  }
  const list = await ModCase.find(filter).sort({ caseId: -1 }).lean()
  for (const c of list) {
    const linked = await ModCase.exists({ linkedCaseId: c.caseId })
    if (!linked) return c as unknown as ModCaseDoc
  }
  return null
}

export async function getCaseByNumber(guildId: string, caseId: number): Promise<ModCaseDoc | null> {
  return (await ModCase.findOne({ guildId, caseId }).lean()) as unknown as ModCaseDoc | null
}

export async function getLinkedNextCase(guildId: string, caseId: number): Promise<ModCaseDoc | null> {
  return (await ModCase.findOne({ guildId, linkedCaseId: caseId }).sort({ caseId: 1 }).lean()) as unknown as ModCaseDoc | null
}
