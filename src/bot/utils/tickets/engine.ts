import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
} from "discord.js"
import { colors } from "../../config.js"
import { appEmojiComponent, appEmojiText } from "../appEmojis.js"
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

export async function sendTicketsLog(
  client: Client,
  guildId: string,
  body: string,
  files: AttachmentBuilder[] = []
): Promise<void> {
  try {
    const config = await getConfig(guildId)
    if (!config.logsChannelId) return
    const channel = await resolveSendableChannel(client, config.logsChannelId)
    if (!channel) return
    const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
    container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.notes} 〃 Journal des tickets`))
    container.addSeparatorComponents((s) => s.setSpacing(1))
    container.addTextDisplayComponents((t) => t.setContent(body))
    await channel.send({
      components: [container],
      flags: COMPONENTS_V2_FLAGS,
      allowedMentions: { parse: [] },
      files,
    })
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

function ticketStatusLine(record: TicketRecordModel): string {
  if (record.closedAt) return `${appEmojiText("cancel")} **Fermé**`
  if (record.claimedBy) return `${appEmojiText("check")} **Claim par** <@${record.claimedBy}>`
  return `${appEmojiText("power")} **Ouvert**`
}

export function buildTicketEmbed(
  guild: Guild,
  category: TicketCategory | undefined,
  record: TicketRecordModel,
  ctx?: TicketVariableContext
): EmbedBuilder {
  void guild
  const embed = category ? buildSimpleTicketEmbed(category.openEmbed, { ctx }) : new EmbedBuilder()
  if (!embed.data.title) embed.setTitle(`Ticket #${padTicketNumber(record.number)}`)
  if (!embed.data.color && colors.prime) embed.setColor(colors.prime)
  if (record.extraMemberIds.length > 0) {
    embed.addFields({
      name: "Membres ajoutés",
      value: record.extraMemberIds.map((id) => `<@${id}>`).join(", "),
    })
  }
  return embed
}

/** Boutons/select d'action du ticket, rendus en dehors du Container (top-level, comme le dashboard config). */
export function buildTicketActionRows(
  config: TicketsConfig,
  record: TicketRecordModel
): Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> {
  const closed = Boolean(record.closedAt)
  const enabled = new Set(config.enabledButtons)
  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = []

  const actionRow = new ActionRowBuilder<ButtonBuilder>()
  if (config.claimEnabled) {
    if (record.claimedBy) {
      actionRow.addComponents(
        new ButtonBuilder().setCustomId("tk_claim").setLabel("Sur-Claim").setStyle(ButtonStyle.Success).setDisabled(closed),
        new ButtonBuilder().setCustomId("tk_unclaim").setLabel("Unclaim").setStyle(ButtonStyle.Secondary).setDisabled(closed)
      )
    } else {
      actionRow.addComponents(
        new ButtonBuilder().setCustomId("tk_claim").setLabel("Claim").setStyle(ButtonStyle.Success).setDisabled(closed)
      )
    }
  }
  if (closed) {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId("tk_reopen").setLabel("Réouvrir").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("tk_delete").setLabel("Supprimer").setStyle(ButtonStyle.Danger)
    )
  } else {
    actionRow.addComponents(new ButtonBuilder().setCustomId("tk_close").setLabel("Fermer").setStyle(ButtonStyle.Danger))
  }
  if (actionRow.components.length > 0) rows.push(actionRow)

  const manageRow = new ActionRowBuilder<ButtonBuilder>()
  if (enabled.has("rename")) {
    manageRow.addComponents(
      new ButtonBuilder()
        .setCustomId("tk_rename_btn")
        .setEmoji({ id: "1469693057497563160" })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed)
    )
  }
  if (enabled.has("addmember")) {
    manageRow.addComponents(
      new ButtonBuilder()
        .setCustomId("tk_addmember_btn")
        .setEmoji({ id: "1469692082107977782" })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed)
    )
  }
  if (enabled.has("removemember")) {
    manageRow.addComponents(
      new ButtonBuilder()
        .setCustomId("tk_removemember_btn")
        .setEmoji({ id: "1270005485764083722" })
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed || record.extraMemberIds.length === 0)
    )
  }
  if (manageRow.components.length > 0) rows.push(manageRow)

  return rows
}

export function buildTicketPayload(
  guild: Guild,
  config: TicketsConfig,
  category: TicketCategory | undefined,
  record: TicketRecordModel,
  ctx?: TicketVariableContext
): {
  embeds: EmbedBuilder[]
  components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>
} {
  return { embeds: [buildTicketEmbed(guild, category, record, ctx)], components: buildTicketActionRows(config, record) }
}

async function refreshTicketMessage(
  client: Client,
  guild: Guild,
  record: TicketRecordModel,
  ctx?: TicketVariableContext
): Promise<void> {
  if (!record.messageId) return
  try {
    const channel = await resolveSendableChannel(client, record.channelId)
    if (!channel) return
    const message = await channel.messages.fetch(record.messageId).catch(() => null)
    if (!message) return
    const config = await getConfig(guild.id)
    const category = config.categories.find((entry) => entry.id === record.categoryId)
    const payload = buildTicketPayload(guild, config, category, record, ctx)
    await message
      .edit({ embeds: payload.embeds, components: payload.components })
      .catch(() => undefined)
  } catch (error) {
    console.error(`Failed to refresh ticket message for channel ${record.channelId}:`, error)
  }
}

async function buildTranscript(channel: Message["channel"], number: number): Promise<AttachmentBuilder | null> {
  try {
    if (!("messages" in channel)) return null
    const collected: Message[] = []
    let before: string | undefined
    for (let i = 0; i < 10; i++) {
      const batch = await channel.messages.fetch({ limit: 100, before })
      if (batch.size === 0) break
      collected.push(...batch.values())
      before = batch.last()?.id
      if (batch.size < 100) break
    }
    collected.reverse()
    const lines = collected.map((msg) => {
      const time = new Date(msg.createdTimestamp).toISOString().slice(0, 19).replace("T", " ")
      const content = msg.content || (msg.attachments.size > 0 ? "[pièce jointe]" : "[message vide]")
      return `[${time}] ${msg.author.tag} (${msg.author.id}) : ${content}`
    })
    const text = lines.join("\n") || "Aucun message."
    return new AttachmentBuilder(Buffer.from(text, "utf-8"), { name: `transcript-${padTicketNumber(number)}.txt` })
  } catch (error) {
    console.error("Failed to build ticket transcript:", error)
    return null
  }
}

async function isStaffMember(guild: Guild, config: TicketsConfig, record: TicketRecordModel, member: GuildMember): Promise<boolean> {
  const category = config.categories.find((entry) => entry.id === record.categoryId)
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || (category ? hasAnyRole(member, category.staffRoleIds) : false)
}

function mapRecord(raw: Record<string, unknown>): TicketRecordModel {
  return {
    guildId: String(raw.guildId),
    channelId: String(raw.channelId),
    messageId: typeof raw.messageId === "string" ? raw.messageId : null,
    userId: String(raw.userId),
    categoryId: String(raw.categoryId),
    number: Number(raw.number),
    claimedBy: typeof raw.claimedBy === "string" ? raw.claimedBy : null,
    closedAt: typeof raw.closedAt === "number" ? raw.closedAt : null,
    createdAt: Number(raw.createdAt ?? Date.now()),
    extraMemberIds: Array.isArray(raw.extraMemberIds) ? raw.extraMemberIds.filter((v): v is string => typeof v === "string") : [],
  }
}

async function findOpenRecord(channelId: string): Promise<TicketRecordModel | null> {
  const raw = await TicketRecords.findOne({ channelId }).lean()
  if (!raw) return null
  const record = mapRecord(raw as unknown as Record<string, unknown>)
  if (record.closedAt !== null) return null
  return record
}

async function findAnyRecord(channelId: string): Promise<TicketRecordModel | null> {
  const raw = await TicketRecords.findOne({ channelId }).lean()
  if (!raw) return null
  return mapRecord(raw as unknown as Record<string, unknown>)
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

  const nowTs = Date.now()
  const created = await TicketRecords.create({
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    userId: member.id,
    categoryId: category.id,
    number,
    claimedBy: null,
    closedAt: null,
    createdAt: nowTs,
    extraMemberIds: [],
  })
  void created

  const mentions = category.mentionRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")
  const record: TicketRecordModel = {
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    userId: member.id,
    categoryId: category.id,
    number,
    claimedBy: null,
    closedAt: null,
    createdAt: nowTs,
    extraMemberIds: [],
  }
  const payload = buildTicketPayload(guild, config, category, record, ctx)

  const sentMessage = await channel
    .send({
      content: mentions.trim() || undefined,
      embeds: payload.embeds,
      components: payload.components,
      allowedMentions: { roles: category.mentionRoleIds, users: [member.id] },
    })
    .catch((error: unknown) => {
      console.error(`Failed to send ticket opening message in guild ${guild.id}:`, error)
      return null
    })

  if (sentMessage) {
    await TicketRecords.updateOne({ channelId: channel.id }, { $set: { messageId: sentMessage.id } })
  }

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
  const member = await fetchMember(guild, interaction.user.id)
  if (!member) return
  if (!(await isStaffMember(guild, config, record, member))) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent claim ce ticket.*")
    return
  }
  if (record.claimedBy === member.id) {
    await replyEphemeral(interaction, "> *Vous avez déjà revendiqué ce ticket.*")
    return
  }
  const isSurClaim = Boolean(record.claimedBy)
  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { claimedBy: member.id } })
  record.claimedBy = member.id
  if (interaction.isRepliable() && interaction.isMessageComponent()) {
    const category = config.categories.find((entry) => entry.id === record.categoryId)
    await interaction
      .update(buildTicketPayload(guild, config, category, record))
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
  const allowed = member.id === record.userId || (await isStaffMember(guild, config, record, member))
  if (!allowed) {
    await replyEphemeral(interaction, "> *Vous n'êtes pas autorisé à fermer ce ticket.*")
    return
  }

  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { closedAt: Date.now() } })
  record.closedAt = Date.now()
  if (interaction.isRepliable() && interaction.isMessageComponent()) {
    await interaction
      .update(buildTicketPayload(guild, config, category, record))
      .catch(() => undefined)
  }

  const me = await guild.members.fetchMe().catch(() => null)
  const channel = interaction.channel
  if (me && channel && !channel.isThread() && "permissionOverwrites" in channel && !channel.name.endsWith("-ferme")) {
    await channel.setName(`${channel.name}-ferme`.slice(0, 100)).catch(() => undefined)
    await channel.permissionOverwrites.delete(record.userId, "Ticket fermé").catch(() => undefined)
    for (const extraId of record.extraMemberIds) {
      await channel.permissionOverwrites.delete(extraId, "Ticket fermé").catch(() => undefined)
    }
  }

  await interaction.channel
    .send({
      content: `> 🔒 *Ticket \`${padTicketNumber(record.number)}\` fermé par <@${member.id}>.*`,
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined)

  const transcript = await buildTranscript(interaction.channel, record.number)

  await sendTicketsLog(
    client,
    guild.id,
    `> **Fermeture** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Par :** <@${member.id}> · \`${member.user.tag}\`\n` +
      `> **Ouvert par :** <@${record.userId}>\n` +
      `> **Salon :** <#${record.channelId}>`,
    transcript ? [transcript] : []
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
  const member = await fetchMember(guild, interaction.user.id)
  if (!member) return
  if (!(await isStaffMember(guild, config, record, member))) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent unclaim ce ticket.*")
    return
  }

  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { claimedBy: null } })
  record.claimedBy = null
  if (interaction.isRepliable() && interaction.isMessageComponent()) {
    const category = config.categories.find((entry) => entry.id === record.categoryId)
    await interaction
      .update(buildTicketPayload(guild, config, category, record))
      .catch(() => undefined)
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

async function reopenTicket(client: Client, interaction: Interaction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findAnyRecord(interaction.channel.id)
  if (!record || !record.closedAt) {
    await replyEphemeral(interaction, "> *Ce ticket n'est pas fermé.*")
    return
  }
  const config = await getConfig(guild.id)
  const member = await fetchMember(guild, interaction.user.id)
  if (!member) return
  if (!(await isStaffMember(guild, config, record, member))) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent réouvrir ce ticket.*")
    return
  }

  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { closedAt: null } })
  record.closedAt = null

  const channel = interaction.channel
  if (channel && !channel.isThread() && "permissionOverwrites" in channel) {
    const restoredName = channel.name.endsWith("-ferme") ? channel.name.slice(0, -"-ferme".length) : channel.name
    await channel.setName(restoredName.slice(0, 100)).catch(() => undefined)
    await channel.permissionOverwrites
      .edit(record.userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        EmbedLinks: true,
        AttachFiles: true,
      })
      .catch(() => undefined)
    for (const extraId of record.extraMemberIds) {
      await channel.permissionOverwrites
        .edit(extraId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true })
        .catch(() => undefined)
    }
  }

  if (interaction.isRepliable() && interaction.isMessageComponent()) {
    const category = config.categories.find((entry) => entry.id === record.categoryId)
    await interaction
      .update(buildTicketPayload(guild, config, category, record))
      .catch(() => undefined)
  }

  await interaction.channel
    .send({
      content: `> ${appEmojiText("check")} *Ticket \`${padTicketNumber(record.number)}\` réouvert par <@${member.id}>.*`,
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined)

  await sendTicketsLog(
    client,
    guild.id,
    `> **Réouverture** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Par :** <@${member.id}> · \`${member.user.tag}\`\n` +
      `> **Salon :** <#${record.channelId}>`
  )

  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: "> *Ticket réouvert.*", flags: MessageFlags.Ephemeral }).catch(() => undefined)
  }
}

async function deleteTicket(client: Client, interaction: Interaction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findAnyRecord(interaction.channel.id)
  if (!record || !record.closedAt) {
    await replyEphemeral(interaction, "> *Ce ticket doit être fermé avant de pouvoir être supprimé.*")
    return
  }
  const config = await getConfig(guild.id)
  const member = await fetchMember(guild, interaction.user.id)
  if (!member) return
  if (!(await isStaffMember(guild, config, record, member))) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent supprimer ce ticket.*")
    return
  }

  const category = config.categories.find((entry) => entry.id === record.categoryId)
  void category

  if (interaction.isRepliable()) {
    await interaction
      .deferReply({ flags: MessageFlags.Ephemeral })
      .catch(() => undefined)
  }

  const transcript = await buildTranscript(interaction.channel, record.number)

  await sendTicketsLog(
    client,
    guild.id,
    `> **Suppression** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Par :** <@${member.id}> · \`${member.user.tag}\`\n` +
      `> **Ouvert par :** <@${record.userId}>\n` +
      `> **Salon :** <#${record.channelId}>`,
    transcript ? [transcript] : []
  )

  await TicketRecords.deleteOne({ channelId: record.channelId }).catch(() => undefined)

  await editEphemeral(interaction, `> ${appEmojiText("cancel")} *Suppression du ticket...*`)

  await interaction.channel
    .delete(`Ticket #${padTicketNumber(record.number)} supprimé par ${member.user.tag}`)
    .catch((error: unknown) => {
      console.error(`Failed to delete ticket channel ${record.channelId}:`, error)
      void editEphemeral(interaction, "> *La suppression du salon a échoué. Vérifiez mes permissions.*")
    })
}

function buildRenameModal(currentName: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("tk_rename_modal")
    .setTitle("Renommer le ticket")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Nouveau nom du salon")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(MAX_CHANNEL_NAME_LENGTH)
          .setValue(currentName.slice(0, MAX_CHANNEL_NAME_LENGTH))
      )
    )
}

async function handleRenameModal(client: Client, interaction: Interaction): Promise<void> {
  if (!interaction.isModalSubmit() || !interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findOpenRecord(interaction.channel.id)
  if (!record) {
    await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
    return
  }
  const config = await getConfig(guild.id)
  const member = await fetchMember(guild, interaction.user.id)
  if (!member) {
    await replyEphemeral(interaction, "> *Impossible de vérifier votre accès à ce ticket.*")
    return
  }
  if (!(await isStaffMember(guild, config, record, member))) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent renommer ce ticket.*")
    return
  }

  const raw = interaction.fields.getTextInputValue("name").trim()
  const cleaned = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\-_]/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, MAX_CHANNEL_NAME_LENGTH)

  if (!cleaned) {
    await replyEphemeral(interaction, "> *Nom invalide.*")
    return
  }

  const channel = interaction.channel
  if (!channel.isThread() && "setName" in channel) {
    await channel.setName(cleaned).catch(() => undefined)
  }

  await replyEphemeral(interaction, `> ${appEmojiText("check")} *Salon renommé en \`${cleaned}\`.*`)

  await sendTicketsLog(
    client,
    guild.id,
    `> **Renommage** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Par :** <@${member.id}> · \`${member.user.tag}\`\n` +
      `> **Nouveau nom :** \`${cleaned}\`\n` +
      `> **Salon :** <#${record.channelId}>`
  )
}

async function handleAddMemberButton(interaction: Interaction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findOpenRecord(interaction.channel.id)
  if (!record) {
    await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
    return
  }
  const config = await getConfig(guild.id)
  const member = await fetchMember(guild, interaction.user.id)
  if (!member || !(await isStaffMember(guild, config, record, member))) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent ajouter un membre.*")
    return
  }
  if (interaction.isRepliable()) {
    await interaction
      .reply({
        content: "> *Choisissez le membre à ajouter au ticket :*",
        components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId("tk_addmember_select").setMaxValues(1))],
        flags: MessageFlags.Ephemeral,
      })
      .catch((error: unknown) => {
        console.error("Failed to send add-member select menu:", error)
      })
  }
}

async function handleRemoveMemberButton(interaction: Interaction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findOpenRecord(interaction.channel.id)
  if (!record) {
    await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
    return
  }
  if (record.extraMemberIds.length === 0) {
    await replyEphemeral(interaction, "> *Aucun membre n'a été ajouté manuellement à ce ticket.*")
    return
  }
  const config = await getConfig(guild.id)
  const member = await fetchMember(guild, interaction.user.id)
  if (!member || !(await isStaffMember(guild, config, record, member))) {
    await replyEphemeral(interaction, "> *Seuls les membres du staff peuvent retirer un membre.*")
    return
  }
  if (interaction.isRepliable()) {
    await interaction
      .reply({
        content: "> *Choisissez le membre à retirer du ticket :*",
        components: [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder().setCustomId("tk_removemember_select").setMaxValues(1)
          ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      .catch((error: unknown) => {
        console.error("Failed to send remove-member select menu:", error)
      })
  }
}

async function handleAddMemberSelect(interaction: Interaction): Promise<void> {
  if (!interaction.isUserSelectMenu() || !interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findOpenRecord(interaction.channel.id)
  if (!record) {
    await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
    return
  }
  const targetId = interaction.values[0]
  if (!targetId) return
  if (targetId === record.userId || record.extraMemberIds.includes(targetId)) {
    await replyEphemeral(interaction, "> *Ce membre a déjà accès au ticket.*")
    return
  }

  const channel = interaction.channel
  if (!channel.isThread() && "permissionOverwrites" in channel) {
    await channel.permissionOverwrites
      .edit(targetId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true })
      .catch(() => undefined)
  }

  const extraMemberIds = [...record.extraMemberIds, targetId].slice(0, 10)
  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { extraMemberIds } })
  record.extraMemberIds = extraMemberIds

  await replyEphemeral(interaction, `> ${appEmojiText("check")} *<@${targetId}> a été ajouté au ticket.*`)
  await refreshTicketMessage(guild.client, guild, record)

  await sendTicketsLog(
    guild.client,
    guild.id,
    `> **Ajout membre** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Membre ajouté :** <@${targetId}>\n` +
      `> **Par :** <@${interaction.user.id}>\n` +
      `> **Salon :** <#${record.channelId}>`
  )
}

async function handleRemoveMemberSelect(interaction: Interaction): Promise<void> {
  if (!interaction.isUserSelectMenu() || !interaction.inGuild() || !interaction.guild || !interaction.channel) return
  const guild = interaction.guild
  const record = await findOpenRecord(interaction.channel.id)
  if (!record) {
    await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
    return
  }
  const targetId = interaction.values[0]
  if (!targetId || !record.extraMemberIds.includes(targetId)) {
    await replyEphemeral(interaction, "> *Ce membre n'a pas été ajouté manuellement à ce ticket.*")
    return
  }

  const channel = interaction.channel
  if (!channel.isThread() && "permissionOverwrites" in channel) {
    await channel.permissionOverwrites.delete(targetId, "Retiré du ticket").catch(() => undefined)
  }

  const extraMemberIds = record.extraMemberIds.filter((id) => id !== targetId)
  await TicketRecords.updateOne({ channelId: record.channelId }, { $set: { extraMemberIds } })
  record.extraMemberIds = extraMemberIds

  await replyEphemeral(interaction, `> ${appEmojiText("check")} *<@${targetId}> a été retiré du ticket.*`)
  await refreshTicketMessage(guild.client, guild, record)

  await sendTicketsLog(
    guild.client,
    guild.id,
    `> **Retrait membre** — \`${padTicketNumber(record.number)}\`\n` +
      `> **Membre retiré :** <@${targetId}>\n` +
      `> **Par :** <@${interaction.user.id}>\n` +
      `> **Salon :** <#${record.channelId}>`
  )
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

  if (interaction.isButton() && interaction.customId === "tk_reopen") {
    await reopenTicket(client, interaction)
    return true
  }

  if (interaction.isButton() && interaction.customId === "tk_delete") {
    await deleteTicket(client, interaction)
    return true
  }

  if (interaction.isButton() && interaction.customId === "tk_rename_btn") {
    const record = await findOpenRecord(interaction.channel?.id ?? "")
    const channelName = interaction.channel && "name" in interaction.channel ? interaction.channel.name : ""
    if (!record) {
      await replyEphemeral(interaction, "> *Ce ticket est introuvable ou déjà fermé.*")
      return true
    }
    if (interaction.isRepliable()) {
      await interaction.showModal(buildRenameModal(channelName)).catch((error: unknown) => {
        console.error("Failed to show rename modal:", error)
      })
    }
    return true
  }

  if (interaction.isModalSubmit() && interaction.customId === "tk_rename_modal") {
    await handleRenameModal(client, interaction)
    return true
  }

  if (interaction.isButton() && interaction.customId === "tk_addmember_btn") {
    await handleAddMemberButton(interaction)
    return true
  }

  if (interaction.isButton() && interaction.customId === "tk_removemember_btn") {
    await handleRemoveMemberButton(interaction)
    return true
  }

  if (interaction.isUserSelectMenu() && interaction.customId === "tk_addmember_select") {
    await handleAddMemberSelect(interaction)
    return true
  }

  if (interaction.isUserSelectMenu() && interaction.customId === "tk_removemember_select") {
    await handleRemoveMemberSelect(interaction)
    return true
  }

  return false
}
