import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type Guild,
  type Interaction,
  type User,
} from "discord.js"
import { appEmojiComponent } from "../appEmojis.js"
import { buildPartnershipEmbed, sendToChannel } from "./logs.js"
import {
  Partner,
  PartnershipRequest,
  getConfig,
  getRequestById,
  type PartnershipRequestDoc,
} from "./schema.js"

const BUTTON_PREFIX = "partnership"

export function reviewButtonId(action: "approve" | "deny", requestId: number): string {
  return `${BUTTON_PREFIX}_${action}_${requestId}`
}

export function buildReviewRow(requestId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(reviewButtonId("approve", requestId))
      .setLabel("Accepter")
      .setEmoji(appEmojiComponent("check"))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(reviewButtonId("deny", requestId))
      .setLabel("Refuser")
      .setEmoji(appEmojiComponent("cancel"))
      .setStyle(ButtonStyle.Danger)
  )
}

export interface CooldownResult {
  ok: boolean
  remaining: number
}

export async function checkCooldown(guildId: string, requesterId: string): Promise<CooldownResult> {
  const config = await getConfig(guildId)
  if (config.cooldown <= 0) return { ok: true, remaining: 0 }

  const last = await PartnershipRequest.findOne({ guildId, requesterId }).sort({ createdAt: -1 }).lean()
  if (!last) return { ok: true, remaining: 0 }

  const elapsed = Date.now() - last.createdAt
  if (elapsed >= config.cooldown) return { ok: true, remaining: 0 }
  return { ok: false, remaining: config.cooldown - elapsed }
}

async function dmUser(user: User, title: string, desc: string): Promise<boolean> {
  try {
    await user.send({ embeds: [buildPartnershipEmbed("people", title, desc)] })
    return true
  } catch {
    return false
  }
}

export async function postReviewRequest(
  client: Client,
  guild: Guild,
  request: PartnershipRequestDoc
): Promise<void> {
  const config = await getConfig(guild.id)
  const embed = buildPartnershipEmbed(
    "people",
    `Nouvelle demande — ${request.requestIdFormatted}`,
    `> ***Serveur cible :** ${request.targetGuildName} (\`${request.targetGuildId}\`)*\n` +
      `> ***Membres approx. :** ${request.targetMemberCount}*\n` +
      `> ***Invitation :** discord.gg/${request.inviteCode}*\n` +
      `> ***Demandeur :** <@${request.requesterId}> (\`${request.requesterId}\`)*\n` +
      `> ***Description :**\n> ${request.description}*`
  )

  const messageId = await sendToChannel(client, config.reviewChannel, embed, {
    components: [buildReviewRow(request.requestId)],
  })

  if (messageId) {
    await PartnershipRequest.updateOne(
      { guildId: guild.id, requestId: request.requestId },
      { reviewChannelId: config.reviewChannel, reviewMessageId: messageId }
    )
  }
}

function statusText(status: "APPROVED" | "DENIED", reviewerUsername: string, reason?: string): string {
  if (status === "APPROVED") return `> ***Statut :** ✅ Accepté par ${reviewerUsername}*`
  return `> ***Statut :** ❌ Refusé par ${reviewerUsername}*\n> ***Raison :** ${reason ?? "—"}*`
}

async function refreshReviewMessage(
  client: Client,
  request: PartnershipRequestDoc,
  statusLine: string
): Promise<void> {
  try {
    if (!request.reviewChannelId || !request.reviewMessageId) return
    const channel = client.channels.cache.get(request.reviewChannelId)
    if (!channel || !channel.isTextBased()) return
    const message = await channel.messages.fetch(request.reviewMessageId).catch(() => null)
    if (!message) return
    const embed = buildPartnershipEmbed(
      "people",
      `Demande ${request.requestIdFormatted}`,
      `> ***Serveur cible :** ${request.targetGuildName} (\`${request.targetGuildId}\`)*\n` +
        `> ***Demandeur :** <@${request.requesterId}>*\n` +
        `> ***Description :**\n> ${request.description}*\n\n` +
        statusLine
    )
    await message.edit({ embeds: [embed], components: [] })
  } catch (error) {
    console.error("Failed to refresh partnership review message:", error)
  }
}

export interface DecisionResult {
  ok: boolean
  error?: string
}

export async function approveRequest(
  client: Client,
  guild: Guild,
  requestId: number,
  reviewer: { id: string; username: string }
): Promise<DecisionResult> {
  const request = await getRequestById(guild.id, requestId)
  if (!request) return { ok: false, error: "Demande introuvable." }
  if (request.status !== "PENDING") return { ok: false, error: "Cette demande a déjà été traitée." }

  const now = Date.now()
  await PartnershipRequest.updateOne(
    { guildId: guild.id, requestId },
    { status: "APPROVED", reviewerId: reviewer.id, reviewerUsername: reviewer.username, reviewedAt: now }
  )

  await Partner.findOneAndUpdate(
    { guildId: guild.id, targetGuildId: request.targetGuildId },
    {
      guildId: guild.id,
      targetGuildId: request.targetGuildId,
      targetGuildName: request.targetGuildName,
      inviteCode: request.inviteCode,
      requesterId: request.requesterId,
      requesterUsername: request.requesterUsername,
      requestId: request.requestId,
      addedAt: now,
    },
    { upsert: true }
  )

  const config = await getConfig(guild.id)
  if (config.partnerRole) {
    try {
      const member = await guild.members.fetch(request.requesterId)
      await member.roles.add(config.partnerRole, `Partenariat accepté (${request.requestIdFormatted})`)
    } catch {
      /* le membre a peut-être quitté, ou le bot manque de permissions — ignoré */
    }
  }

  await sendToChannel(
    client,
    config.announceChannel,
    buildPartnershipEmbed(
      "check",
      "Nouveau partenariat",
      `> *Un partenariat vient d'être conclu avec* **${request.targetGuildName}** !\n` +
        `> ***Rejoignez-les :** discord.gg/${request.inviteCode}*`
    )
  )

  await refreshReviewMessage(client, request, statusText("APPROVED", reviewer.username))

  const requester = await client.users.fetch(request.requesterId).catch(() => null)
  if (requester) {
    await dmUser(
      requester,
      "Partenariat accepté",
      `> *Votre demande de partenariat avec **${guild.name}** a été acceptée !*\n> ***Référence :** ${request.requestIdFormatted}*`
    )
  }

  return { ok: true }
}

export async function denyRequest(
  client: Client,
  guild: Guild,
  requestId: number,
  reviewer: { id: string; username: string },
  reason: string
): Promise<DecisionResult> {
  const request = await getRequestById(guild.id, requestId)
  if (!request) return { ok: false, error: "Demande introuvable." }
  if (request.status !== "PENDING") return { ok: false, error: "Cette demande a déjà été traitée." }

  await PartnershipRequest.updateOne(
    { guildId: guild.id, requestId },
    {
      status: "DENIED",
      reviewerId: reviewer.id,
      reviewerUsername: reviewer.username,
      reviewedAt: Date.now(),
      denyReason: reason,
    }
  )

  await refreshReviewMessage(client, request, statusText("DENIED", reviewer.username, reason))

  const requester = await client.users.fetch(request.requesterId).catch(() => null)
  if (requester) {
    await dmUser(
      requester,
      "Partenariat refusé",
      `> *Votre demande de partenariat avec **${guild.name}** a été refusée.*\n` +
        `> ***Raison :** ${reason}*\n> ***Référence :** ${request.requestIdFormatted}*`
    )
  }

  return { ok: true }
}

export async function handlePartnershipButton(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false
  const match = new RegExp(`^${BUTTON_PREFIX}_(approve|deny)_(\\d+)$`).exec(interaction.customId)
  if (!match) return false
  if (!interaction.guild) return true

  const [, action, requestIdStr] = match
  const requestId = Number(requestIdStr)

  const memberPermissions = interaction.memberPermissions
  if (!memberPermissions?.has("ManageGuild")) {
    await interaction
      .reply({ content: "> *Cette action nécessite la permission **Gérer le serveur**.*", ephemeral: true })
      .catch(() => undefined)
    return true
  }

  await interaction.deferUpdate().catch(() => undefined)

  const reviewer = { id: interaction.user.id, username: interaction.user.username }
  const result =
    action === "approve"
      ? await approveRequest(client, interaction.guild, requestId, reviewer)
      : await denyRequest(client, interaction.guild, requestId, reviewer, "Non conforme aux règles du serveur.")

  if (!result.ok) {
    await interaction.followUp({ content: `> *${result.error}*`, ephemeral: true }).catch(() => undefined)
  }

  return true
}
