import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js"
import { colors } from "../../config.js"
import { appEmojiComponent, appEmojiHeading, appEmojiText, type AppEmojiName } from "../appEmojis.js"
import {
  applyChannelPermissions,
  deleteChannel,
  memberIsBlacklisted,
  memberIsAllowed,
  recordByChannelId,
  saveRecord,
  transferOwnership,
  userCanManage,
  voiceChannelMembers,
} from "./engine.js"
import {
  MAX_CHANNEL_NAME_LENGTH,
  MAX_USER_LIMIT,
  clampPattern,
  defaultConfig,
  getConfig,
  padChannelNumber,
  updateConfig,
  type J2CChannelRecord,
  type J2CConfig,
} from "./schema.js"
import { buildJ2CVariablesEmbed, sanitizeChannelName } from "./variables.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

function buildTextContainer(text: string): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(text))
  return [container]
}

const PEN_EMOJI_ID = "1469693057497563160"

const PREFIX_CFG = "j2ccfg_"
const PREFIX_CFG_MODAL = "j2ccfg_modal_"
const PREFIX_OWNER = "j2c:"
const PREFIX_MODAL = "j2cmodal:"
const PREFIX_USERSEL = "j2cu:"
const PREFIX_ROLESSEL = "j2cr:"
const PREFIX_MEMBER = "j2cm:"

const penEmoji = (): { id: string } => ({ id: PEN_EMOJI_ID })

const APP_STATUS = {
  lock: appEmojiText("pin"),
  eye: appEmojiText("people"),
  mic: appEmojiText("power"),
} as const

function onOff(enabled: boolean): string {
  return `${appEmojiText("power")} ${enabled ? "Activé" : "Désactivé"}`
}

function previewText(value: string, max = 80): string {
  const one = value.replace(/\s+/g, " ").trim()
  if (!one) return "*Vide*"
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "Aucun"
}

function mentionList(ids: string[]): string {
  if (ids.length === 0) return "Aucun"
  return ids.map((id) => `<@${id}>`).join(" ")
}

function roleList(ids: string[]): string {
  if (ids.length === 0) return "Aucun"
  return ids.map((id) => `<@&${id}>`).join(" ")
}

async function requireManageGuild(interaction: Interaction): Promise<boolean> {
  const member = interaction.member
  const memberPermissions =
    member && typeof member.permissions === "object" && member.permissions !== null ? member.permissions : null
  if (!member || !memberPermissions || !memberPermissions.has("ManageGuild")) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: "> *Cette action nécessite la permission **Gérer le serveur**.*",
        flags: MessageFlags.Ephemeral,
      })
    }
    return false
  }
  return true
}

async function replyEphemeral(interaction: MessageComponentInteraction | ModalSubmitInteraction, content: string): Promise<boolean> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined)
  return true
}

// ---------------------------------------------------------------------------
// Config panel (/config → Join to Create)
// ---------------------------------------------------------------------------

export function buildJ2CContainer(_client: Client, guild: Guild, config: J2CConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading("people", "Join to Create")))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Quand un membre rejoint le **salon source**, un salon vocal personnel lui est créé, avec sa **discussion textuelle intégrée**.*\n\n` +
        `> **État :** ${onOff(config.enabled)}\n` +
        `> **Salon source :** ${channelMention(config.sourceChannelId)}\n` +
        `> **Catégorie parente :** ${channelMention(config.categoryId)}\n` +
        `> **Nom du salon :** \`${previewText(config.channelNamePattern, 60)}\`\n` +
        `> **Limite par défaut :** ${config.userLimit > 0 ? config.userLimit : "Illimité"}\n` +
        `> **Ignorer les bots :** ${config.ignoreBots ? `${appEmojiText("power")} Oui` : `${appEmojiText("power")} Non`}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation du module**\n> ${onOff(config.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`${PREFIX_CFG}toggle`)
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )

  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon source & catégorie**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX_CFG}source`)
        .setPlaceholder("Choisir le salon vocal source...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildVoice)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX_CFG}cat`)
        .setPlaceholder("Catégorie parente des salons créés (optionnel)...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildCategory)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX_CFG}source_clear`)
        .setLabel("Retirer le salon source")
        .setEmoji(appEmojiComponent("cancel"))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!config.sourceChannelId),
      new ButtonBuilder()
        .setCustomId(`${PREFIX_CFG}cat_clear`)
        .setLabel("Retirer la catégorie")
        .setEmoji(appEmojiComponent("cancel"))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!config.categoryId)
    )
  )

  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Nom des salons créés**\n> \`${previewText(config.channelNamePattern, 60)}\`\n> *Variables : {memberName}, {channelNumber}…*`))
      .setButtonAccessory((btn) => btn.setCustomId(`${PREFIX_CFG}namebtn`).setEmoji(penEmoji()).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Limite de membres par défaut**\n> ${config.userLimit > 0 ? config.userLimit : "Illimité"} (0 = illimité)`))
      .setButtonAccessory((btn) => btn.setCustomId(`${PREFIX_CFG}limitbtn`).setEmoji(penEmoji()).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Ignorer les bots**\n> ${config.ignoreBots ? "Les bots ne créent pas de salon" : "Les bots peuvent créer un salon"}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`${PREFIX_CFG}bots`)
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.ignoreBots ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )

  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX_CFG}vars`)
        .setLabel("Voir les variables")
        .setEmoji(appEmojiComponent("file"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX_CFG}reset`)
        .setLabel("Réinitialiser")
        .setEmoji(appEmojiComponent("cancel"))
        .setStyle(ButtonStyle.Danger)
    )
  )
  void guild
  return [container]
}

function buildCfgModals(config: J2CConfig): Record<string, ModalBuilder> {
  const nameInput = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Nom du salon vocal (variables autorisées)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(MAX_CHANNEL_NAME_LENGTH)
    .setPlaceholder("{memberName}'s Channel")
    .setValue(config.channelNamePattern.slice(0, MAX_CHANNEL_NAME_LENGTH))
  const limitInput = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Limite de membres (0 = illimité)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2)
    .setPlaceholder("0")
    .setValue(String(config.userLimit))
  return {
    [`${PREFIX_CFG_MODAL}name`]: new ModalBuilder()
      .setCustomId(`${PREFIX_CFG_MODAL}name`)
      .setTitle("Nom des salons créés")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput)),
    [`${PREFIX_CFG_MODAL}limit`]: new ModalBuilder()
      .setCustomId(`${PREFIX_CFG_MODAL}limit`)
      .setTitle("Limite de membres")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(limitInput)),
  }
}

async function refreshCfgPanel(client: Client, interaction: Interaction, guild: Guild): Promise<void> {
  const config = await getConfig(guild.id)
  if (interaction.isMessageComponent()) {
    await interaction.update({ components: buildJ2CContainer(client, guild, config), flags: COMPONENTS_V2_FLAGS })
    return
  }
  if (interaction.isRepliable()) {
    await interaction.reply({ components: buildJ2CContainer(client, guild, config), flags: COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral })
  }
}

async function handleCfgInteraction(client: Client, interaction: Interaction, guild: Guild): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId

  if (interaction.isButton() && customId === `${PREFIX_CFG}toggle`) {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { enabled: !config.enabled } })
    await refreshCfgPanel(client, interaction, guild)
    return true
  }

  if (interaction.isButton() && customId === `${PREFIX_CFG}bots`) {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { ignoreBots: !config.ignoreBots } })
    await refreshCfgPanel(client, interaction, guild)
    return true
  }

  if (interaction.isButton() && customId === `${PREFIX_CFG}source_clear`) {
    await updateConfig(guild.id, { $set: { sourceChannelId: null } })
    await refreshCfgPanel(client, interaction, guild)
    return true
  }

  if (interaction.isButton() && customId === `${PREFIX_CFG}cat_clear`) {
    await updateConfig(guild.id, { $set: { categoryId: null } })
    await refreshCfgPanel(client, interaction, guild)
    return true
  }

  if (interaction.isChannelSelectMenu() && customId === `${PREFIX_CFG}source`) {
    const channelId = interaction.values[0]
    await updateConfig(guild.id, { $set: { sourceChannelId: channelId } })
    await refreshCfgPanel(client, interaction, guild)
    return true
  }

  if (interaction.isChannelSelectMenu() && customId === `${PREFIX_CFG}cat`) {
    const channelId = interaction.values[0]
    await updateConfig(guild.id, { $set: { categoryId: channelId } })
    await refreshCfgPanel(client, interaction, guild)
    return true
  }

  if (interaction.isButton() && customId === `${PREFIX_CFG}vars`) {
    await interaction.reply({ embeds: [buildJ2CVariablesEmbed()], flags: MessageFlags.Ephemeral })
    return true
  }

  if (interaction.isButton() && customId === `${PREFIX_CFG}reset`) {
    const defaults = defaultConfig(guild.id)
    await updateConfig(guild.id, { $set: { ...defaults } })
    await refreshCfgPanel(client, interaction, guild)
    return true
  }

  if (interaction.isButton() && [ `${PREFIX_CFG}namebtn`, `${PREFIX_CFG}limitbtn` ].includes(customId)) {
    const config = await getConfig(guild.id)
    const key = `j2ccfg_modal_${customId.slice(PREFIX_CFG.length).replace("btn", "")}`
    const modal = buildCfgModals(config)[key]
    if (modal) await interaction.showModal(modal)
    return true
  }

  if (interaction.isModalSubmit() && interaction.isFromMessage() && customId.startsWith(PREFIX_CFG_MODAL)) {
    const field = customId.slice(PREFIX_CFG_MODAL.length)
    const raw = interaction.fields.getTextInputValue("value").trim()
    if (field === "name") {
      const pattern = clampPattern(raw) || "{memberName}'s Channel"
      await updateConfig(guild.id, { $set: { channelNamePattern: pattern } })
    } else if (field === "limit") {
      const value = parseInt(raw, 10)
      const limit = Number.isNaN(value) ? 0 : Math.min(Math.max(value, 0), MAX_USER_LIMIT)
      await updateConfig(guild.id, { $set: { userLimit: limit } })
    }
    await refreshCfgPanel(client, interaction, guild)
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Owner panel (sent in the voice channel discussion)
// ---------------------------------------------------------------------------

export function buildOwnerPanelPayload(client: Client, guild: Guild, record: J2CChannelRecord): ContainerBuilder[] {
  const voice = guild.channels.cache.get(record.channelId)
  const members = voiceChannelMembers(voice)
  const memberCount = members ? members.size : 0
  const owner = guild.members.cache.get(record.ownerId)
  const currentLimit = voice && "userLimit" in voice ? voice.userLimit ?? 0 : 0

  const emoji = (name: AppEmojiName) => appEmojiComponent(name)
  const status = [
    `${APP_STATUS.lock} **Verrouillé :** ${record.locked ? "Oui" : "Non"}`,
    `${APP_STATUS.eye} **Masqué :** ${record.hidden ? "Oui" : "Non"}`,
    `${APP_STATUS.mic} **Mute tous :** ${record.serverMuteAll ? "Oui" : "Non"} · **Sourdine :** ${record.serverDeafenAll ? "Oui" : "Non"}`,
    `👥 **Membres connectés :** ${memberCount} · **N° :** \`#${padChannelNumber(record.number)}\``,
  ].join("\n")

  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) =>
    t.setContent(appEmojiHeading("people", `Salon — ${owner?.displayName ?? "Owner"} (${padChannelNumber(record.number)})`))
  )
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Panneau de contrôle de <#${record.channelId}>.*\n> *Vous et les co-owners pouvez gérer ce salon.*\n\n${status}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Verrouillage**\n> ${record.locked ? "Seuls les membres autorisés peuvent se connecter" : "Tout le monde peut se connecter"}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`${PREFIX_OWNER}${record.channelId}:lock`)
          .setEmoji(emoji("pin"))
          .setStyle(record.locked ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Visibilité**\n> ${record.hidden ? "Salon masqué (sur invitation)" : "Salon visible par tous"}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`${PREFIX_OWNER}${record.channelId}:hide`)
          .setEmoji(emoji("people"))
          .setStyle(record.hidden ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Mute général**\n> ${record.serverMuteAll ? "Tous les membres sont en mute" : "Membres libres de parler"}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`${PREFIX_OWNER}${record.channelId}:mutall`)
          .setEmoji(emoji("power"))
          .setStyle(record.serverMuteAll ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Sourdine générale**\n> ${record.serverDeafenAll ? "Membres en sourdine complète" : "Sourdine générale inactive"}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`${PREFIX_OWNER}${record.channelId}:deafall`)
          .setEmoji(emoji("power"))
          .setStyle(record.serverDeafenAll ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Limite de membres**\n> ${currentLimit > 0 ? currentLimit : "Illimité"}`))
      .setButtonAccessory((btn) => btn.setCustomId(`${PREFIX_OWNER}${record.channelId}:limit`).setEmoji(emoji("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Renommer le salon**\n> \`${previewText(voice ? voice.name : "", 60)}\``))
      .setButtonAccessory((btn) => btn.setCustomId(`${PREFIX_OWNER}${record.channelId}:rename`).setEmoji(penEmoji()).setStyle(ButtonStyle.Secondary))
  )

  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `**Co-owners**\n> ${record.coOwnerIds.length > 0 ? mentionList(record.coOwnerIds) : "Aucun"} · **Autorisés :** ${mentionList(record.allowedUserIds)}\n` +
        `**Rôles autorisés :** ${roleList(record.allowedRoleIds)} · **Rôles blacklist :** ${roleList(record.blacklistRoleIds)}`
    )
  )

  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder().setCustomId(`${PREFIX_OWNER}${record.channelId}:actions`).setPlaceholder("Actions rapides...").addOptions(
        { label: "Ajouter un co-owner", value: "addcow", emoji: "👑" },
        { label: "Retirer un co-owner", value: "rmcow", emoji: "👑" },
        { label: "Autoriser un membre", value: "allow", emoji: "✅" },
        { label: "Blacklister un membre", value: "blk", emoji: "❌" },
        { label: "Transférer la propriété", value: "transfer", emoji: "🎁" },
      )
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId(`${PREFIX_ROLESSEL}${record.channelId}:allow`).setPlaceholder("Ajouter des rôles autorisés...").setMaxValues(5)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId(`${PREFIX_ROLESSEL}${record.channelId}:blk`).setPlaceholder("Ajouter des rôles blacklist...").setMaxValues(5)
    )
  )

  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`${PREFIX_OWNER}${record.channelId}:member`).setLabel("Gérer un membre").setEmoji(emoji("people")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX_OWNER}${record.channelId}:kickall`).setLabel("Éjecter tous").setEmoji(emoji("cancel")).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX_OWNER}${record.channelId}:refresh`).setLabel("Rafraîchir").setEmoji(emoji("loop")).setStyle(ButtonStyle.Secondary)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`${PREFIX_OWNER}${record.channelId}:close`).setLabel("Fermer & supprimer").setEmoji(emoji("cancel")).setStyle(ButtonStyle.Danger)
    )
  )

  return [container]
}

export async function sendOwnerPanel(client: Client, guild: Guild, record: J2CChannelRecord): Promise<void> {
  const payload = buildOwnerPanelPayload(client, guild, record)
  const voice = guild.channels.cache.get(record.channelId)
  if (!voice || !("send" in voice)) return
  if (record.panelMessageId) {
    try {
      const existing = await voice.messages.fetch(record.panelMessageId)
      if (existing) {
        await existing.edit({ components: payload, flags: COMPONENTS_V2_FLAGS })
        return
      }
    } catch {
      /* message deleted — resend */
    }
  }
  const sent = await voice
    .send({ components: payload, flags: COMPONENTS_V2_FLAGS })
    .catch((error) => {
      console.error(`Failed to send J2C owner panel in guild ${guild.id}:`, error)
      return null
    })
  if (sent) {
    record.panelMessageId = sent.id
    await saveRecord(record)
  }
}

export async function refreshOwnerPanel(client: Client, guild: Guild, record: J2CChannelRecord): Promise<void> {
  await sendOwnerPanel(client, guild, record)
}

function channelIdFromOwnerId(customId: string, prefix: string): string {
  return customId.slice(prefix.length).split(":")[0] ?? ""
}

async function fetchGuildMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null))
}

async function buildOwnerMemberSelect(record: J2CChannelRecord, interaction: MessageComponentInteraction): Promise<boolean> {
  const guild = interaction.guild
  if (!guild) return false
  const members = voiceChannelMembers(guild.channels.cache.get(record.channelId))
  if (!members || members.size === 0) {
    await replyEphemeral(interaction, "> *Personne n'est connecté à ce salon.*")
    return true
  }
  const options = [...members.values()]
    .map((member) => ({ label: (member.displayName || member.user.username).slice(0, 100), value: member.id }))
    .slice(0, 25)
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX_MEMBER}${record.channelId}:pick`).setPlaceholder("Choisir un membre...").setMaxValues(1).addOptions(options)
  await interaction.reply({
    content: "> *Choisissez un membre à gérer :*",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  })
  return true
}

function isOwner(record: J2CChannelRecord, userId: string): boolean {
  return record.ownerId === userId
}

interface OwnerPanelRouter {
  client: Client
  interaction: MessageComponentInteraction | ModalSubmitInteraction
  guild: Guild
  record: J2CChannelRecord
}

async function enforceOwnerProtection(ctx: OwnerPanelRouter, targetId: string): Promise<boolean> {
  const actorId = ctx.interaction.user.id
  if (isOwner(ctx.record, actorId)) return false
  if (targetId === ctx.record.ownerId) {
    await replyEphemeral(ctx.interaction, "> *En tant que co-owner, vous ne pouvez pas agir sur le propriétaire du salon.*")
    return true
  }
  return false
}

async function toggleMemberList(ctx: OwnerPanelRouter, action: "allow" | "blk", userIds: string[]): Promise<void> {
  const record = ctx.record
  if (action === "blk") {
    record.blacklistUserIds = [...new Set([...record.blacklistUserIds, ...userIds])].slice(0, 25)
    record.allowedUserIds = record.allowedUserIds.filter((id) => !userIds.includes(id))
  } else {
    record.allowedUserIds = [...new Set([...record.allowedUserIds, ...userIds])].slice(0, 25)
    record.blacklistUserIds = record.blacklistUserIds.filter((id) => !userIds.includes(id))
  }
  await saveRecord(record)
  if (action === "blk") {
    const members = voiceChannelMembers(ctx.guild.channels.cache.get(record.channelId))
    for (const id of userIds) {
      const member = members?.get(id)
      if (member) await member.voice.disconnect("JoinToCreate — membre blacklisté").catch(() => undefined)
    }
  }
}

async function handleOwnerAction(client: Client, interaction: MessageComponentInteraction): Promise<boolean> {
  const customId = interaction.customId
  const channelId = channelIdFromOwnerId(customId, PREFIX_OWNER)
  if (!channelId) return false
  const guild = interaction.guild
  const record = await recordByChannelId(channelId)
  if (!guild || !record) {
    await replyEphemeral(interaction, "> *Ce salon n'existe plus ou ne fait plus partie du système Join to Create.*")
    return true
  }
  if (!userCanManage(record, interaction.user.id)) {
    await replyEphemeral(interaction, "> *Seuls le propriétaire et les co-owners de ce salon peuvent le gérer.*")
    return true
  }
  const action = customId.slice(PREFIX_OWNER.length + channelId.length + 1)
  const ctx: OwnerPanelRouter = { client, interaction, guild, record }
  const actorIsOwner = isOwner(record, interaction.user.id)
  const panelRefresh = () => interaction.update({ components: buildOwnerPanelPayload(client, guild, record), flags: COMPONENTS_V2_FLAGS })

  if (action === "refresh") {
    await refreshOwnerPanel(client, guild, record)
    await interaction.reply({ content: "> *Panneau actualisé.*", flags: MessageFlags.Ephemeral })
    return true
  }

  if (action === "lock") {
    record.locked = !record.locked
    await saveRecord(record)
    await applyChannelPermissions(guild, record)
    await panelRefresh()
    return true
  }

  if (action === "hide") {
    record.hidden = !record.hidden
    await saveRecord(record)
    await applyChannelPermissions(guild, record)
    await panelRefresh()
    return true
  }

  if (action === "mutall") {
    record.serverMuteAll = !record.serverMuteAll
    await saveRecord(record)
    const members = voiceChannelMembers(guild.channels.cache.get(record.channelId))
    if (members) {
      for (const member of members.values()) {
        if (!actorIsOwner && member.id === record.ownerId) continue
        if (!record.serverMuteAll && member.id === interaction.user.id) continue
        await member.voice.setMute(record.serverMuteAll, "JoinToCreate — mute général").catch(() => undefined)
      }
    }
    await panelRefresh()
    return true
  }

  if (action === "deafall") {
    record.serverDeafenAll = !record.serverDeafenAll
    await saveRecord(record)
    const members = voiceChannelMembers(guild.channels.cache.get(record.channelId))
    if (members) {
      for (const member of members.values()) {
        if (member.id === record.ownerId && !actorIsOwner) continue
        await member.voice.setDeaf(record.serverDeafenAll, "JoinToCreate — sourdine générale").catch(() => undefined)
      }
    }
    await panelRefresh()
    return true
  }

  if (action === "kickall") {
    const members = voiceChannelMembers(guild.channels.cache.get(record.channelId))
    if (members) {
      for (const member of members.values()) {
        if (!actorIsOwner && member.id === record.ownerId) continue
        await member.voice.disconnect("JoinToCreate — éjection générale").catch(() => undefined)
      }
    }
    await panelRefresh()
    return true
  }

  if (action === "member") {
    return buildOwnerMemberSelect(record, interaction)
  }

  if (action === "limit") {
    const voiceChannel = guild.channels.cache.get(record.channelId)
    const current = voiceChannel && "userLimit" in voiceChannel ? voiceChannel.userLimit ?? 0 : 0
    const input = new TextInputBuilder().setCustomId("value").setLabel("Limite de membres (0 = illimité)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(String(current))
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${PREFIX_MODAL}${record.channelId}:limit`)
        .setTitle("Limite de membres")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
    )
    return true
  }

  if (action === "rename") {
    const voice = guild.channels.cache.get(record.channelId)
    const input = new TextInputBuilder().setCustomId("value").setLabel("Nouveau nom du salon vocal").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(MAX_CHANNEL_NAME_LENGTH).setValue((voice && "name" in voice ? voice.name : "").slice(0, MAX_CHANNEL_NAME_LENGTH))
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${PREFIX_MODAL}${record.channelId}:rename`)
        .setTitle("Renommer le salon")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
    )
    return true
  }

  if (action === "close") {
    if (!actorIsOwner) {
      await replyEphemeral(interaction, "> *Seul le propriétaire peut supprimer le salon.*")
      return true
    }
    const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
    container.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("cancel")} 〃 Supprimer le salon`))
    container.addSeparatorComponents((s) => s.setSpacing(1))
    container.addTextDisplayComponents((t) =>
      t.setContent("> *Le salon vocal et sa discussion seront supprimés définitivement. Confirmer ?*")
    )
    container.addActionRowComponents((row) =>
      row.setComponents(
        new ButtonBuilder().setCustomId(`${PREFIX_OWNER}${record.channelId}:close_confirm`).setLabel("Oui, supprimer").setEmoji(appEmojiComponent("cancel")).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${PREFIX_OWNER}${record.channelId}:close_cancel`).setLabel("Annuler").setEmoji(appEmojiComponent("check")).setStyle(ButtonStyle.Secondary)
      )
    )
    await interaction.reply({ content: "", components: [container], flags: COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral })
    return true
  }

  if (action === "close_confirm" || action === "close_cancel") {
    if (action === "close_cancel") {
      await interaction.update({ components: buildTextContainer("> *Suppression annulée.*"), flags: COMPONENTS_V2_FLAGS })
      return true
    }
    await interaction.update({ components: buildTextContainer("> *Salon supprimé.*"), flags: COMPONENTS_V2_FLAGS })
    await deleteChannel(guild, record, `Salon J2C #${String(record.number).padStart(4, "0")} supprimé par ${interaction.user.tag}`).catch(() => undefined)
    return true
  }

  if (action === "actions") {
    if (!interaction.isStringSelectMenu()) return false
    const selected = interaction.values[0]
    if (selected === "addcow") {
      if (!actorIsOwner) {
        await replyEphemeral(interaction, "> *Seul le propriétaire peut ajouter des co-owners.*")
        return true
      }
      await interaction.reply({
        content: "> *Choisissez les co-owners à ajouter (max 5) :*",
        components: [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`${PREFIX_USERSEL}${record.channelId}:cow`)
              .setPlaceholder("Ajouter des co-owners...")
              .setMinValues(1)
              .setMaxValues(Math.max(1, 5 - record.coOwnerIds.length))
          ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    if (selected === "rmcow") {
      if (!actorIsOwner) {
        await replyEphemeral(interaction, "> *Seul le propriétaire peut retirer des co-owners.*")
        return true
      }
      if (record.coOwnerIds.length === 0) {
        await replyEphemeral(interaction, "> *Aucun co-owner à retirer.*")
        return true
      }
      await interaction.reply({
        content: "> *Choisissez le co-owner à retirer :*",
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`${PREFIX_MEMBER}${record.channelId}:rmcow`)
              .setPlaceholder("Retirer un co-owner...")
              .setMaxValues(1)
              .addOptions(
                record.coOwnerIds
                  .slice(0, 25)
                  .map((id) => ({ label: guild.members.cache.get(id)?.displayName ?? id, value: id, emoji: "👑" }))
              )
          ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    if (selected === "allow" || selected === "blk") {
      await interaction.reply({
        content: selected === "allow" ? "> *Choisissez les membres à autoriser :*" : "> *Choisissez les membres à blacklister :*",
        components: [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`${PREFIX_USERSEL}${record.channelId}:${selected}`)
              .setPlaceholder("Sélection...")
              .setMinValues(1)
              .setMaxValues(5)
          ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    if (selected === "transfer") {
      if (!actorIsOwner) {
        await replyEphemeral(interaction, "> *Seul le propriétaire peut transférer le salon.*")
        return true
      }
      await interaction.reply({
        content: "> *Choisissez le nouveau propriétaire :*",
        components: [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`${PREFIX_USERSEL}${record.channelId}:transfer`)
              .setPlaceholder("Choisir le nouveau propriétaire...")
              .setMaxValues(1)
          ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Public router
// ---------------------------------------------------------------------------

export async function handleJ2CInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId

  if (customId.startsWith(PREFIX_CFG)) {
    if (!interaction.inGuild() || !interaction.guild) return false
    if (!(await requireManageGuild(interaction))) return true
    return handleCfgInteraction(client, interaction, interaction.guild)
  }

  if (
    customId.startsWith(PREFIX_OWNER) ||
    customId.startsWith(PREFIX_MODAL) ||
    customId.startsWith(PREFIX_USERSEL) ||
    customId.startsWith(PREFIX_ROLESSEL) ||
    customId.startsWith(PREFIX_MEMBER)
  ) {
    return handleOwnerInteraction(client, interaction)
  }

  return false
}

async function handleOwnerInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId

  // Owner sub-menus (member management, co-owner removal) use PREFIX_MEMBER / PREFIX_USERSEL
  if (interaction.isModalSubmit()) {
    if (!customId.startsWith(PREFIX_MODAL)) return false
    const channelId = customId.slice(PREFIX_MODAL.length).split(":")[0] ?? ""
    const record = await recordByChannelId(channelId)
    const guild = record ? client.guilds.cache.get(record.guildId) : undefined
    if (!record || !guild) {
      await replyEphemeral(interaction, "> *Ce salon n'existe plus.*")
      return true
    }
    if (!userCanManage(record, interaction.user.id)) {
      await replyEphemeral(interaction, "> *Vous ne pouvez pas gérer ce salon.*")
      return true
    }
    const field = customId.slice(PREFIX_MODAL.length + channelId.length + 1)
    const raw = interaction.fields.getTextInputValue("value").trim()
    const voice = guild.channels.cache.get(record.channelId)
    if (field === "rename" && voice && "setName" in voice) {
      const cleaned = sanitizeChannelName(raw).slice(0, MAX_CHANNEL_NAME_LENGTH)
      if (!cleaned) {
        await replyEphemeral(interaction, "> *Nom invalide.*")
        return true
      }
      await voice.setName(cleaned).catch(() => undefined)
      await interaction.reply({ content: "> *Salon renommé.*", flags: MessageFlags.Ephemeral })
      await refreshOwnerPanel(client, guild, record)
      return true
    }
    if (field === "limit" && voice && "setUserLimit" in voice) {
      const value = parseInt(raw, 10)
      const limit = Number.isNaN(value) ? 0 : Math.min(Math.max(value, 0), MAX_USER_LIMIT)
      await voice.setUserLimit(limit).catch(() => undefined)
      await interaction.reply({ content: `> *Limite mise à jour : ${limit > 0 ? limit : "illimité"}.*`, flags: MessageFlags.Ephemeral })
      await refreshOwnerPanel(client, guild, record)
      return true
    }
    return false
  }

  if (customId.startsWith(PREFIX_MEMBER)) {
    return handleMemberInteraction(client, interaction)
  }

  if (customId.startsWith(PREFIX_USERSEL)) {
    if (!interaction.isUserSelectMenu()) return false
    const channelId = customId.slice(PREFIX_USERSEL.length).split(":")[0] ?? ""
    const record = await recordByChannelId(channelId)
    const guild = record ? client.guilds.cache.get(record.guildId) : undefined
    if (!record || !guild) {
      await replyEphemeral(interaction, "> *Ce salon n'existe plus.*")
      return true
    }
    if (!userCanManage(record, interaction.user.id)) {
      await replyEphemeral(interaction, "> *Vous ne pouvez pas gérer ce salon.*")
      return true
    }
    const purpose = customId.slice(PREFIX_USERSEL.length + channelId.length + 1)
    const userIds = interaction.values
    const ctx: OwnerPanelRouter = { client, interaction, guild, record }
    if (purpose === "allow" || purpose === "blk") {
      if (purpose === "blk" && userIds.includes(record.ownerId) && !isOwner(record, interaction.user.id)) {
        await replyEphemeral(interaction, "> *En tant que co-owner, vous ne pouvez pas blacklister le propriétaire.*")
        return true
      }
      await toggleMemberList(ctx, purpose, userIds)
      await applyChannelPermissions(guild, record)
      await interaction.reply({ content: `> *Membres ${purpose === "allow" ? "autorisés" : "blacklistés"} avec succès.*`, flags: MessageFlags.Ephemeral })
      await refreshOwnerPanel(client, guild, record)
      return true
    }
    if (purpose === "cow" || purpose === "transfer") {
      if (!isOwner(record, interaction.user.id)) {
        await replyEphemeral(interaction, "> *Seul le propriétaire peut gérer la propriété du salon.*")
        return true
      }
      if (purpose === "cow") {
        const newCo = userIds.filter((id) => id !== record.ownerId && !record.coOwnerIds.includes(id))
        if (newCo.length === 0) {
          await replyEphemeral(interaction, "> *Ces utilisateurs sont déjà co-owners (ou sont le propriétaire).*")
          return true
        }
        record.coOwnerIds = [...new Set([...record.coOwnerIds, ...newCo])].slice(0, 5)
        record.allowedUserIds = record.allowedUserIds.filter((id) => !newCo.includes(id))
        await saveRecord(record)
        await applyChannelPermissions(guild, record)
        await interaction.reply({ content: `> *Co-owners ajoutés : ${newCo.map((id) => `<@${id}>`).join(" ")}*`, flags: MessageFlags.Ephemeral })
        await refreshOwnerPanel(client, guild, record)
      } else {
        const targetId = userIds[0]
        if (!targetId || targetId === record.ownerId) {
          await replyEphemeral(interaction, "> *Propriétaire invalide.*")
          return true
        }
        await transferOwnership(client, guild, record, targetId)
        await interaction.reply({ content: `> *Propriété transférée à <@${targetId}>.*`, flags: MessageFlags.Ephemeral })
        await refreshOwnerPanel(client, guild, record)
      }
      return true
    }
    return false
  }

  if (customId.startsWith(PREFIX_ROLESSEL)) {
    if (!interaction.isRoleSelectMenu()) return false
    const channelId = customId.slice(PREFIX_ROLESSEL.length).split(":")[0] ?? ""
    const record = await recordByChannelId(channelId)
    const guild = record ? client.guilds.cache.get(record.guildId) : undefined
    if (!record || !guild) {
      await replyEphemeral(interaction, "> *Ce salon n'existe plus.*")
      return true
    }
    if (!userCanManage(record, interaction.user.id)) {
      await replyEphemeral(interaction, "> *Vous ne pouvez pas gérer ce salon.*")
      return true
    }
    const purpose = customId.slice(PREFIX_ROLESSEL.length + channelId.length + 1)
    const roleIds = interaction.values.filter((id) => id !== guild.id)
    if (purpose === "allow") record.allowedRoleIds = [...new Set(roleIds)].slice(0, 25)
    else record.blacklistRoleIds = [...new Set(roleIds)].slice(0, 25)
    await saveRecord(record)
    await applyChannelPermissions(guild, record)
    await interaction.reply({ content: `> *Rôles ${purpose === "allow" ? "autorisés" : "blacklistés"} mis à jour.*`, flags: MessageFlags.Ephemeral })
    await refreshOwnerPanel(client, guild, record)
    return true
  }

  if (!interaction.isMessageComponent()) return false
  return handleOwnerAction(client, interaction)
}

async function handleMemberInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  const channelId = customId.slice(PREFIX_MEMBER.length).split(":")[0] ?? ""
  const record = await recordByChannelId(channelId)
  const guild = record ? client.guilds.cache.get(record.guildId) : undefined
  if (!interaction.inGuild() || !record || !guild) {
    await replyEphemeral(interaction, "> *Ce salon n'existe plus.*")
    return true
  }
  if (!userCanManage(record, interaction.user.id)) {
    await replyEphemeral(interaction, "> *Vous ne pouvez pas gérer ce salon.*")
    return true
  }
  const field = customId.slice(PREFIX_MEMBER.length + channelId.length + 1)

  if (interaction.isStringSelectMenu() && field === "pick") {
    const targetId = interaction.values[0]
    const target = voiceChannelMembers(guild.channels.cache.get(record.channelId))?.get(targetId)
    if (!target) {
      await replyEphemeral(interaction, "> *Ce membre n'est plus dans le salon.*")
      return true
    }
    const canAct = !(await enforceOwnerProtection({ client, interaction, guild, record }, targetId))
    const muted = target.voice.serverMute ?? false
    const deafened = target.voice.serverDeaf ?? false
    const muteBtn = new ButtonBuilder().setCustomId(`${PREFIX_MEMBER}${channelId}:mute:${targetId}`).setLabel("Mute").setStyle(ButtonStyle.Danger).setDisabled(!canAct || muted)
    const unmuteBtn = new ButtonBuilder().setCustomId(`${PREFIX_MEMBER}${channelId}:unmute:${targetId}`).setLabel("Unmute").setStyle(ButtonStyle.Secondary).setDisabled(!canAct || !muted)
    const deafBtn = new ButtonBuilder().setCustomId(`${PREFIX_MEMBER}${channelId}:deaf:${targetId}`).setLabel("Sourdine").setStyle(ButtonStyle.Danger).setDisabled(!canAct || deafened)
    const undeafBtn = new ButtonBuilder().setCustomId(`${PREFIX_MEMBER}${channelId}:undeaf:${targetId}`).setLabel("Retirer").setStyle(ButtonStyle.Secondary).setDisabled(!canAct || !deafened)
    const kickBtn = new ButtonBuilder().setCustomId(`${PREFIX_MEMBER}${channelId}:kick:${targetId}`).setLabel("Éjecter").setStyle(ButtonStyle.Secondary).setDisabled(!canAct)
    const allowBtn = new ButtonBuilder().setCustomId(`${PREFIX_MEMBER}${channelId}:allow:${targetId}`).setLabel("Autoriser").setStyle(ButtonStyle.Success).setDisabled(!canAct)
    const blkBtn = new ButtonBuilder().setCustomId(`${PREFIX_MEMBER}${channelId}:blk:${targetId}`).setLabel("Blacklister").setStyle(ButtonStyle.Danger).setDisabled(!canAct)
    const doneBtn = new ButtonBuilder().setCustomId(`${PREFIX_MEMBER}${channelId}:done`).setLabel("Terminé").setStyle(ButtonStyle.Secondary)
    const payload = {
      content: `> **Gestion de <@${targetId}>** — actions serveur uniquement (via le bot).`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(muteBtn, unmuteBtn, deafBtn, undeafBtn, kickBtn),
        new ActionRowBuilder<ButtonBuilder>().addComponents(allowBtn, blkBtn, doneBtn),
      ],
      flags: MessageFlags.Ephemeral,
    }
    await interaction.update(payload as never)
    return true
  }

  if (interaction.isButton() && field === "done") {
    await interaction.update({ content: "> *Gestion terminée.*", components: [] })
    return true
  }

  if (interaction.isStringSelectMenu() && field === "rmcow") {
    if (!isOwner(record, interaction.user.id)) {
      await replyEphemeral(interaction, "> *Seul le propriétaire peut retirer des co-owners.*")
      return true
    }
    const targetId = interaction.values[0]
    record.coOwnerIds = record.coOwnerIds.filter((id) => id !== targetId)
    await saveRecord(record)
    await applyChannelPermissions(guild, record)
    await interaction.update({ content: `> *Co-owner retiré : <@${targetId}>.*`, components: [] })
    await refreshOwnerPanel(client, guild, record)
    return true
  }

  if (interaction.isButton() && field.includes(":")) {
    const [action, targetId] = field.split(":")
    const target = await fetchGuildMember(guild, targetId)
    const members = voiceChannelMembers(guild.channels.cache.get(record.channelId))
    const targetInVoice = members?.has(targetId) ?? false
    if (await enforceOwnerProtection({ client, interaction, guild, record }, targetId)) return true
    const ctx: OwnerPanelRouter = { client, interaction, guild, record }
    if (action === "allow" || action === "blk") {
      await toggleMemberList(ctx, action, [targetId])
      await applyChannelPermissions(guild, record)
      if (action === "blk") {
        const member = members?.get(targetId)
        if (member) await member.voice.disconnect("JoinToCreate — membre blacklisté").catch(() => undefined)
      }
      await refreshOwnerPanel(client, guild, record)
      await interaction.update({ content: `> *<@${targetId}> ${action === "allow" ? "autorisé" : "blacklisté"}.*`, components: [] })
      return true
    }
    if (action === "mute" || action === "unmute") {
      if (target && targetInVoice) await target.voice.setMute(action === "mute").catch(() => undefined)
      await interaction.update({ content: `> *<@${targetId}> ${action === "mute" ? "mis en mute" : "unmute"}.*`, components: [] })
      return true
    }
    if (action === "deaf" || action === "undeaf") {
      if (target && targetInVoice) await target.voice.setDeaf(action === "deaf").catch(() => undefined)
      await interaction.update({ content: `> *<@${targetId}> ${action === "deaf" ? "mis en sourdine" : "retiré de la sourdine"}.*`, components: [] })
      return true
    }
    if (action === "kick") {
      if (target && targetInVoice) await target.voice.disconnect("JoinToCreate — éjecté par le gestionnaire").catch(() => undefined)
      await interaction.update({ content: `> *<@${targetId}> a été éjecté du salon.*`, components: [] })
      return true
    }
    return false
  }

  return false
}