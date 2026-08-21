import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
} from "discord.js"
import { colors } from "../../config.js"
import {
  MAX_CATEGORIES,
  MAX_CHANNEL_NAME_LENGTH,
  TicketRecords,
  clampPattern,
  getConfig,
  isValidHexColor,
  nextTicketNumber,
  updateConfig,
  type TicketCategory,
  type TicketEmbedConfig,
  type TicketRecordModel,
  type TicketsConfig,
} from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e
const EMOJI_TAGS = {
  notes: "<:Notes:1469692988870623369>",
} as const

export interface TicketVariableContext {
  ticketNumber: number | string
  memberTag: string
  memberDisplayName: string
  memberUserId: string
}

export function padTicketNumber(value: number | string): string {
  const numeric = Math.max(0, Math.floor(typeof value === "number" ? value : Number(value) || 0))
  return String(numeric).padStart(4, "0")
}

export function replaceTicketVariables(text: string, ctx: TicketVariableContext): string {
  return text
    .replaceAll("{ticketNumber}", typeof ctx.ticketNumber === "string" ? ctx.ticketNumber : padTicketNumber(ctx.ticketNumber))
    .replaceAll("{memberTag}", ctx.memberTag)
    .replaceAll("{memberDisplayName}", ctx.memberDisplayName)
    .replaceAll("{memberUserId}", ctx.memberUserId)
}

export function variableContextFromMember(member: GuildMember, ticketNumber: number): TicketVariableContext {
  return {
    ticketNumber,
    memberTag: member.user.tag,
    memberDisplayName: member.displayName,
    memberUserId: member.id,
  }
}

export function buildChannelName(pattern: string, ctx: TicketVariableContext): string {
  const raw = replaceTicketVariables(clampPattern(pattern) || "{ticketNumber}", ctx)
  const cleaned = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\-_]/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, MAX_CHANNEL_NAME_LENGTH)
  return cleaned || `ticket-${padTicketNumber(ctx.ticketNumber)}`
}

export function categoryLabel(guild: Guild, category: TicketCategory, index: number): string {
  const channel = category.categoryId ? guild.channels.cache.get(category.categoryId) : null
  return (channel?.name ?? `Catégorie ${index + 1}`).slice(0, 80)
}

export function buildSimpleTicketEmbed(
  embedData: TicketEmbedConfig,
  options?: {
    ctx?: TicketVariableContext
    fallbackTitle?: string
    fallbackDescription?: string
  }
): EmbedBuilder {
  const apply = (text: string) => (options?.ctx ? replaceTicketVariables(text, options.ctx) : text)
  const title = apply(embedData.title.trim())
  const description = apply(embedData.description.trim())
  const footer = apply(embedData.footer.trim())
  const embed = new EmbedBuilder()
  if (title) embed.setTitle(title.slice(0, 256))
  else if (!description && options?.fallbackTitle) embed.setTitle(options.fallbackTitle.slice(0, 256))
  if (description) embed.setDescription(description.slice(0, 4096))
  else if (options?.fallbackDescription) embed.setDescription(options.fallbackDescription.slice(0, 4096))
  if (embedData.color && isValidHexColor(embedData.color)) embed.setColor(embedData.color as `#${string}`)
  else if (colors.prime) embed.setColor(colors.prime)
  if (embedData.imageUrl) embed.setImage(embedData.imageUrl)
  if (embedData.thumbnailUrl) embed.setThumbnail(embedData.thumbnailUrl)
  if (footer) embed.setFooter({ text: footer.slice(0, 200) })
  return embed
}

export function buildPanelPayload(
  guild: Guild,
  config: TicketsConfig
): {
  embeds: EmbedBuilder[]
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[]
} {
  const embed = buildSimpleTicketEmbed(config.embed, {
    fallbackTitle: "Tickets",
    fallbackDescription: "> *Ouvrez un ticket grâce aux options ci-dessous.*",
  })
  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = []

  if (config.type === "select") {
    const select = new StringSelectMenuBuilder()
      .setCustomId("tk_panel_select")
      .setPlaceholder("Ouvrir un ticket...")
      .setMaxValues(1)
      .addOptions(
        config.categories.slice(0, MAX_CATEGORIES).map((category, index) => ({
          label: categoryLabel(guild, category, index),
          value: category.id,
          emoji: { name: category.emoji },
        }))
      )
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))
  } else {
    const buttons = config.categories.slice(0, MAX_CATEGORIES).map((category, index) => {
      const button = new ButtonBuilder()
        .setCustomId(`tk_open:${category.id}`)
        .setLabel(categoryLabel(guild, category, index))
        .setStyle(ButtonStyle.Primary)
      if (category.emoji) button.setEmoji({ name: category.emoji })
      return button
    })
    for (let i = 0; i < buttons.length; i += 5) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(i, i + 5)))
    }
  }

  return { embeds: [embed], components }
}

export type PublishResult = { ok: true; config: TicketsConfig } | { ok: false; error: string }

async function resolveSendableChannel(client: Client, channelId: string) {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || channel.isDMBased() || !channel.isTextBased() || !channel.isSendable()) return null
  return channel
}

export async function publishPanel(client: Client, guildId: string, targetChannelId?: string): Promise<PublishResult> {
  const config = await getConfig(guildId)
  if (config.categories.length === 0) {
    return { ok: false, error: "> *Ajoutez au moins une **catégorie** avant d'envoyer le panel.*" }
  }
  const guild = client.guilds.cache.get(guildId)
  if (!guild) return { ok: false, error: "> *Serveur introuvable.*" }

  const channelId = targetChannelId ?? config.panelChannelId
  if (!channelId) return { ok: false, error: "> *Choisissez d'abord un salon d'envoi.*" }

  const channel = await resolveSendableChannel(client, channelId)
  if (!channel) return { ok: false, error: "> *Impossible d'accéder à ce salon. Vérifiez les permissions du bot.*" }

  const payload = buildPanelPayload(guild, config)
  let messageId = config.panelMessageId

  if (messageId && channelId === config.panelChannelId) {
    const existing = await channel.messages.fetch(messageId).catch(() => null)
    if (existing) {
      const edited = await existing
        .edit({
          content: null,
          embeds: payload.embeds,
          components: payload.components,
          allowedMentions: { parse: [] },
        })
        .catch(async (error: unknown) => {
          console.error(`Failed to edit tickets panel in guild ${guildId}:`, error)
          await existing.delete().catch(() => undefined)
          return null
        })
      if (edited) return { ok: true, config }
      messageId = null
    } else {
      messageId = null
    }
  }

  if (messageId && config.panelChannelId && config.panelChannelId !== channelId) {
    const oldChannel = await resolveSendableChannel(client, config.panelChannelId)
    if (oldChannel) await oldChannel.messages.delete(messageId).catch(() => undefined)
    messageId = null
  }

  const sent = await channel
    .send({
      embeds: payload.embeds,
      components: payload.components,
      allowedMentions: { parse: [] },
    })
    .catch((error: unknown) => {
      console.error(`Failed to send tickets panel in guild ${guildId}:`, error)
      return null
    })
  if (!sent) return { ok: false, error: "> *Impossible d'envoyer le panel dans ce salon. Vérifiez les permissions du bot.*" }

  const updated = await updateConfig(guildId, { $set: { panelChannelId: channel.id, panelMessageId: sent.id } })
  return { ok: true, config: updated }
}

export async function republishIfPublished(client: Client, guildId: string): Promise<void> {
  const config = await getConfig(guildId)
  if (!config.panelChannelId || !config.panelMessageId || config.categories.length === 0) return
  await publishPanel(client, guildId)
}

export async function sendTicketsLog(client: Client, guildId: string, body: string): Promise<void> {
  try {
    const config = await getConfig(guildId)
    if (!config.logsChannelId) return
    const channel = await resolveSendableChannel(client, config.logsChannelId)
    if (!channel) return
    const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
    container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.notes} 〃 Journal des tickets`))
    container.addSeparatorComponents((s) => s.setSpacing(1))
    container.addTextDisplayComponents((t) => t.setContent(body))
    await channel.send({ components: [container], flags: COMPONENTS_V2_FLAGS, allowedMentions: { parse: [] } })
  } catch (error) {
    console.error(`Failed to send tickets log in guild ${guildId}:`, error)
  }
}

async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  return (
    guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null))
  )
}

function hasAnyRole(member: GuildMember, roleIds: string[]): boolean {
  return roleIds.some((roleId) => member.roles.cache.has(roleId))
}

function ticketActionRow(claimEnabled: boolean, claimedBy: string | null, closed = false): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>()
  if (claimEnabled) {
    if (claimedBy) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("tk_claim")
          .setLabel("Sur-Claim")
          .setStyle(ButtonStyle.Success)
          .setDisabled(closed),
        new ButtonBuilder()
          .setCustomId("tk_unclaim")
          .setLabel("Unclaim")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(closed)
      )
    } else {
      row.addComponents(
        new ButtonBuilder().setCustomId("tk_claim").setLabel("Claim").setStyle(ButtonStyle.Success).setDisabled(closed)
      )
    }
  }
  row.addComponents(
    new ButtonBuilder().setCustomId("tk_close").setLabel("Fermer").setStyle(ButtonStyle.Danger).setDisabled(closed)
  )
  return row
}

async function findOpenRecord(channelId: string): Promise<TicketRecordModel | null> {
  const raw = await TicketRecords.findOne({ channelId }).lean()
  if (!raw) return null
  const record = raw as unknown as Record<string, unknown>
  if (record.closedAt !== null && record.closedAt !== undefined) return null
  return {
    guildId: String(record.guildId),
    channelId: String(record.channelId),
    userId: String(record.userId),
    categoryId: String(record.categoryId),
    number: Number(record.number),
    claimedBy: typeof record.claimedBy === "string" ? record.claimedBy : null,
    closedAt: typeof record.closedAt === "number" ? record.closedAt : null,
    createdAt: Number(record.createdAt ?? Date.now()),
  }
}

async function replyEphemeral(interaction: Interaction, content: string): Promise<void> {
  if (interaction.isRepliable()) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined)
  }
}

async function editEphemeral(interaction: Interaction, content: string): Promise<void> {
  if (interaction.isRepliable() && (interaction.replied || interaction.deferred)) {
    await interaction.editReply({ content }).catch(() => undefined)
  }
}

async function openTicket(client: Client, interaction: Interaction, categoryId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return
  const guild = interaction.guild
  const config = await getConfig(guild.id)
  const index = config.categories.findIndex((entry) => entry.id === categoryId)
  const category = index >= 0 ? config.categories[index] : null
  if (!category) {
    await replyEphemeral(interaction, "> *Cette catégorie de ticket n'existe plus.*")
    return
  }

  const member = await fetchMember(guild, interaction.user.id)
  if (!member) {
    await replyEphemeral(interaction, "> *Impossible de récupérer votre profil sur ce serveur.*")
    return
  }

  if (config.blacklistRoleIds.length > 0 && hasAnyRole(member, config.blacklistRoleIds)) {
    await replyEphemeral(interaction, "> *Vous n'êtes pas autorisé à ouvrir un ticket.*")
    return
  }

  if (config.requiredRoleIds.length > 0 && !hasAnyRole(member, config.requiredRoleIds)) {
    await replyEphemeral(interaction, "> *Vous n'avez pas le rôle requis pour ouvrir un ticket.*")
    return
  }

  const existing = (await TicketRecords.findOne({ guildId: guild.id, userId: member.id, closedAt: null }).lean()) as unknown as
    | Record<string, unknown>
    | null
  if (existing) {
    await replyEphemeral(interaction, `> *Vous avez déjà un ticket ouvert : <#${String(existing.channelId)}>.*`)
    return
  }

  if (interaction.isRepliable()) await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const me = await guild.members.fetchMe().catch(() => null)
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await editEphemeral(interaction, "> *Il me manque la permission **Gérer les salons** pour créer un ticket.*")
    return
  }

  const number = await nextTicketNumber(guild.id)
  const ctx = variableContextFromMember(member, number)
  const name = buildChannelName(category.channelNamePattern, ctx)

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    ...category.staffRoleIds.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
    ...category.mentionRoleIds.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    })),
  ]

  let channel
  try {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.categoryId ?? undefined,
      permissionOverwrites: overwrites,
      reason: `Ticket #${padTicketNumber(number)} — ${member.user.tag}`,
    })
  } catch (error) {
    console.error(`Failed to create ticket channel in guild ${guild.id}:`, error)
    await editEphemeral(interaction, "> *La création du salon a échoué. Vérifiez mes permissions.*")
    return
  }

  await TicketRecords.create({
    guildId: guild.id,
    channelId: channel.id,
    userId: member.id,
    categoryId: category.id,
    number,
    claimedBy: null,
    closedAt: null,
    createdAt: Date.now(),
  })

  const mentions = category.mentionRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")
  const embed = buildSimpleTicketEmbed(category.openEmbed, {
    ctx,
    fallbackDescription:
      `> *Ticket \`${padTicketNumber(number)}\` ouvert par <@${member.id}>.*\n` +
      `> *Merci de décrire votre demande, le staff va vous répondre.*`,
  })

  await channel
    .send({
      content: mentions.trim() || undefined,
      embeds: [embed],
      allowedMentions: { roles: category.mentionRoleIds, users: [member.id] },
      components: [ticketActionRow(config.claimEnabled, null)],
    })
    .catch((error: unknown) => console.error(`Failed to send ticket opening message in guild ${guild.id}:`, error))

  await editEphemeral(interaction, `> *Votre ticket a été créé : <#${channel.id}>.*`)

  await sendTicketsLog(
    client,
    guild.id,
    `> **Ouverture** — \`${padTicketNumber(number)}\`\n` +
      `> **Membre :** <@${member.id}> · \`${member.user.tag}\`\n` +
      `> **Catégorie :** ${categoryLabel(guild, category, index)}\n` +
      `> **Salon :** <#${channel.id}>`
  )
}

async function claimTicket(client: Client, interaction: Interaction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findOpenRecord(interaction.channel.id)
  if (!record) {
    await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
    return
  }
  const config = await getConfig(guild.id)
  const category = config.categories.find((entry) => entry.id === record.categoryId)
  const member = await fetchMember(guild, interaction.user.id)
  if (!member) return
  const isStaff =
    member.permissions.has(PermissionFlagsBits.ManageGuild) || (category ? hasAnyRole(member, category.staffRoleIds) : false)
  if (!isStaff) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent claim ce ticket.*")
    return
  }
  if (record.claimedBy === member.id) {
    await replyEphemeral(interaction, "> *Vous avez déjà revendiqué ce ticket.*")
    return
  }
  const isSurClaim = Boolean(record.claimedBy)
  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { claimedBy: member.id } })
  if (interaction.isRepliable() && interaction.isMessageComponent()) {
    await interaction
      .update({ components: [ticketActionRow(true, member.id)] })
      .catch(() => undefined)
  }
  await interaction.channel
    .send({
      content: isSurClaim
        ? `> ✋ *Ticket sur-claim par <@${member.id}>.*`
        : `> ✋ *Ticket revendiqué par <@${member.id}>.*`,
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined)

  await sendTicketsLog(
    client,
    guild.id,
    `> **${isSurClaim ? "Sur-Claim" : "Claim"}** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Staff :** <@${member.id}> · \`${member.user.tag}\`\n` +
      `> **Salon :** <#${record.channelId}>`
  )

  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: "> *Ticket revendiqué.*", flags: MessageFlags.Ephemeral }).catch(() => undefined)
  }
}

async function closeTicket(client: Client, interaction: Interaction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findOpenRecord(interaction.channel.id)
  if (!record) {
    await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
    return
  }
  const config = await getConfig(guild.id)
  const category = config.categories.find((entry) => entry.id === record.categoryId)
  const member = await fetchMember(guild, interaction.user.id)
  if (!member) return
  const allowed =
    member.id === record.userId ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    (category ? hasAnyRole(member, category.staffRoleIds) : false)
  if (!allowed) {
    await replyEphemeral(interaction, "> *Vous n'êtes pas autorisé à fermer ce ticket.*")
    return
  }

  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { closedAt: Date.now() } })
  if (interaction.isRepliable() && interaction.isMessageComponent()) {
    await interaction
      .update({ components: [ticketActionRow(config.claimEnabled, record.claimedBy, true)] })
      .catch(() => undefined)
  }

  const me = await guild.members.fetchMe().catch(() => null)
  const channel = interaction.channel
  if (me && channel && !channel.isThread() && "permissionOverwrites" in channel) {
    await channel.setName(`${channel.name}-ferme`.slice(0, 100)).catch(() => undefined)
    await channel.permissionOverwrites.delete(record.userId, "Ticket fermé").catch(() => undefined)
  }

  await interaction.channel
    .send({
      content: `> 🔒 *Ticket \`${padTicketNumber(record.number)}\` fermé par <@${member.id}>.*`,
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined)

  await sendTicketsLog(
    client,
    guild.id,
    `> **Fermeture** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Par :** <@${member.id}> · \`${member.user.tag}\`\n` +
      `> **Ouvert par :** <@${record.userId}>\n` +
      `> **Salon :** <#${record.channelId}>`
  )

  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: "> *Ticket fermé.*", flags: MessageFlags.Ephemeral }).catch(() => undefined)
  }
}

async function unclaimTicket(client: Client, interaction: Interaction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findOpenRecord(interaction.channel.id)
  if (!record) {
    await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
    return
  }
  if (!record.claimedBy) {
    await replyEphemeral(interaction, "> *Ce ticket n'est pas revendiqué.*")
    return
  }
  const config = await getConfig(guild.id)
  const category = config.categories.find((entry) => entry.id === record.categoryId)
  const member = await fetchMember(guild, interaction.user.id)
  if (!member) return
  const isStaff =
    member.permissions.has(PermissionFlagsBits.ManageGuild) || (category ? hasAnyRole(member, category.staffRoleIds) : false)
  if (!isStaff) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent unclaim ce ticket.*")
    return
  }

  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { claimedBy: null } })
  if (interaction.isRepliable() && interaction.isMessageComponent()) {
    await interaction.update({ components: [ticketActionRow(true, null)] }).catch(() => undefined)
  }
  await interaction.channel
    .send({ content: `> *Ticket relâché par <@${member.id}>.*`, allowedMentions: { parse: [] } })
    .catch(() => undefined)

  await sendTicketsLog(
    client,
    guild.id,
    `> **Unclaim** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Staff :** <@${member.id}> · \`${member.user.tag}\`\n` +
      `> **Salon :** <#${record.channelId}>`
  )

  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: "> *Ticket relâché.*", flags: MessageFlags.Ephemeral }).catch(() => undefined)
  }
}

export async function handleTicketActionInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guild) return false

  if (interaction.isButton() && interaction.customId.startsWith("tk_open:")) {
    await openTicket(client, interaction, interaction.customId.slice("tk_open:".length))
    return true
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "tk_panel_select") {
    await openTicket(client, interaction, interaction.values[0] ?? "")
    return true
  }

  if (interaction.isButton() && interaction.customId === "tk_claim") {
    await claimTicket(client, interaction)
    return true
  }

  if (interaction.isButton() && interaction.customId === "tk_unclaim") {
    await unclaimTicket(client, interaction)
    return true
  }

  if (interaction.isButton() && interaction.customId === "tk_close") {
    await closeTicket(client, interaction)
    return true
  }

  return false
}
