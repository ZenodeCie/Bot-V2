import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js"
import { appEmojiComponent, appEmojiHeading, appEmojiText } from "../../appEmojis.js"
import buildErrorEmbed from "../../errorEmbed.js"
import formatTime from "../../formatTime.js"
import parseTime from "../../parseTime.js"
import { PartnershipConfig, getConfig as getPartnershipConfig } from "../../partnership/schema.js"
import { requireAdministrator } from "../access.js"
import { appendBackButton, configUpdatePayload, COMPONENTS_V2_FLAGS, CONTAINER_ACCENT } from "../components.js"
import {
  CFG_BACK,
  CFG_PART_ANNOUNCE_CHANNEL,
  CFG_PART_COOLDOWN_BTN,
  CFG_PART_COOLDOWN_MODAL,
  CFG_PART_MINMEMBERS_BTN,
  CFG_PART_MINMEMBERS_MODAL,
  CFG_PART_REVIEW_CHANNEL,
  CFG_PART_ROLE,
  CFG_PART_TOGGLE,
} from "../constants.js"

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "*Aucun*"
}

function roleMention(roleId: string | null): string {
  return roleId ? `<@&${roleId}>` : "*Aucun*"
}

function onOff(enabled: boolean): string {
  return enabled ? `${appEmojiText("check")} Activé` : `${appEmojiText("cancel")} Désactivé`
}

export async function buildPartenariatContainer(_client: Client, guild: Guild): Promise<ContainerBuilder[]> {
  const cfg = await getPartnershipConfig(guild.id)
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading("people", "Partenariat")))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Demandes de partenariat soumises par les membres, validées par le staff.*\n\n` +
        `> **État :** ${onOff(cfg.enabled)}\n` +
        `> ${appEmojiText("file")} **Salon de validation :** ${channelMention(cfg.reviewChannel)}\n` +
        `> ${appEmojiText("file")} **Salon d'annonce :** ${channelMention(cfg.announceChannel)}\n` +
        `> ${appEmojiText("people")} **Rôle partenaire :** ${roleMention(cfg.partnerRole)}\n` +
        `> ${appEmojiText("settings")} **Cooldown :** ${cfg.cooldown > 0 ? formatTime(cfg.cooldown) : "—"}\n` +
        `> ${appEmojiText("settings")} **Membres min. requis :** ${cfg.minMembers > 0 ? cfg.minMembers : "—"}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) => t.setContent("**Activer / Désactiver**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(CFG_PART_TOGGLE)
          .setEmoji(appEmojiComponent(cfg.enabled ? "power" : "check"))
          .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )

  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon de validation (staff)**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CFG_PART_REVIEW_CHANNEL)
        .setPlaceholder("Choisir le salon de validation...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )

  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon d'annonce (public)**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CFG_PART_ANNOUNCE_CHANNEL)
        .setPlaceholder("Choisir le salon d'annonce...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )

  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("people")} **Rôle attribué au partenaire**`))
  container.addActionRowComponents((row) =>
    row.setComponents(new RoleSelectMenuBuilder().setCustomId(CFG_PART_ROLE).setPlaceholder("Choisir un rôle...").setMaxValues(1))
  )

  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) =>
        t.setContent(`**Cooldown entre deux demandes**\n> ${cfg.cooldown > 0 ? formatTime(cfg.cooldown) : "—"}`)
      )
      .setButtonAccessory((btn) =>
        btn.setCustomId(CFG_PART_COOLDOWN_BTN).setLabel("Modifier").setEmoji(appEmojiComponent("settings")).setStyle(ButtonStyle.Secondary)
      )
  )

  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) =>
        t.setContent(`**Membres minimum requis**\n> ${cfg.minMembers > 0 ? cfg.minMembers : "—"}`)
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(CFG_PART_MINMEMBERS_BTN)
          .setLabel("Modifier")
          .setEmoji(appEmojiComponent("settings"))
          .setStyle(ButtonStyle.Secondary)
      )
  )

  return [container]
}

function buildCooldownModal(current: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(CFG_PART_COOLDOWN_MODAL)
    .setTitle("Cooldown entre deux demandes")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("cooldown")
          .setLabel("Durée (ex: 24h, 30m, none)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(16)
          .setValue(current > 0 ? formatTime(current) : "none")
      )
    )
}

function buildMinMembersModal(current: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(CFG_PART_MINMEMBERS_MODAL)
    .setTitle("Membres minimum requis")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("minmembers")
          .setLabel("Nombre de membres (0 = désactivé)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(6)
          .setValue(String(current))
      )
    )
}

async function refresh(interaction: MessageComponentInteraction, client: Client, guild: Guild) {
  const panels = await buildPartenariatContainer(client, guild)
  await interaction.update(configUpdatePayload(appendBackButton(panels, CFG_BACK)))
}

export async function handlePartenariatPanelInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (interaction.isModalSubmit()) {
    if (interaction.customId === CFG_PART_COOLDOWN_MODAL) return handleCooldownModal(interaction)
    if (interaction.customId === CFG_PART_MINMEMBERS_MODAL) return handleMinMembersModal(interaction)
    return false
  }

  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false

  const ids = [
    CFG_PART_TOGGLE,
    CFG_PART_REVIEW_CHANNEL,
    CFG_PART_ANNOUNCE_CHANNEL,
    CFG_PART_ROLE,
    CFG_PART_COOLDOWN_BTN,
    CFG_PART_MINMEMBERS_BTN,
  ]
  if (!ids.includes(interaction.customId)) return false
  if (!(await requireAdministrator(interaction))) return true

  const guild = interaction.guild!

  if (interaction.customId === CFG_PART_TOGGLE) {
    const cfg = await getPartnershipConfig(guild.id)
    await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { enabled: !cfg.enabled }, { upsert: true })
    await refresh(interaction, client, guild)
    return true
  }

  if (interaction.customId === CFG_PART_REVIEW_CHANNEL && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null
    await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { reviewChannel: channelId }, { upsert: true })
    await refresh(interaction, client, guild)
    return true
  }

  if (interaction.customId === CFG_PART_ANNOUNCE_CHANNEL && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null
    await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { announceChannel: channelId }, { upsert: true })
    await refresh(interaction, client, guild)
    return true
  }

  if (interaction.customId === CFG_PART_ROLE && interaction.isRoleSelectMenu()) {
    const roleId = interaction.values[0] ?? null
    await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { partnerRole: roleId }, { upsert: true })
    await refresh(interaction, client, guild)
    return true
  }

  if (interaction.customId === CFG_PART_COOLDOWN_BTN) {
    const cfg = await getPartnershipConfig(guild.id)
    await interaction.showModal(buildCooldownModal(cfg.cooldown))
    return true
  }

  if (interaction.customId === CFG_PART_MINMEMBERS_BTN) {
    const cfg = await getPartnershipConfig(guild.id)
    await interaction.showModal(buildMinMembersModal(cfg.minMembers))
    return true
  }

  return false
}

async function handleCooldownModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.inGuild()) return false
  if (!(await requireAdministrator(interaction))) return true

  const raw = interaction.fields.getTextInputValue("cooldown").trim().toLowerCase()
  const ms = raw === "none" || raw === "0" ? 0 : parseTime(raw)
  if (ms === null) {
    await interaction.reply({
      embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemple : `24h`, `30m`, `none`.*")],
      flags: ["Ephemeral"],
    })
    return true
  }

  await PartnershipConfig.findOneAndUpdate({ guildId: interaction.guildId! }, { cooldown: ms }, { upsert: true })
  const guild = interaction.guild!
  const panels = await buildPartenariatContainer(interaction.client, guild)
  if (!interaction.isFromMessage()) return true
  await interaction.update(configUpdatePayload(appendBackButton(panels, CFG_BACK)))
  return true
}

async function handleMinMembersModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.inGuild()) return false
  if (!(await requireAdministrator(interaction))) return true

  const raw = interaction.fields.getTextInputValue("minmembers").trim()
  const min = Number(raw)
  if (!Number.isFinite(min) || min < 0) {
    await interaction.reply({
      embeds: [buildErrorEmbed("400 Bad Request", "> *Valeur invalide. Exemple : `50`.*")],
      flags: ["Ephemeral"],
    })
    return true
  }

  await PartnershipConfig.findOneAndUpdate({ guildId: interaction.guildId! }, { minMembers: Math.floor(min) }, { upsert: true })
  const guild = interaction.guild!
  const panels = await buildPartenariatContainer(interaction.client, guild)
  if (!interaction.isFromMessage()) return true
  await interaction.update(configUpdatePayload(appendBackButton(panels, CFG_BACK)))
  return true
}

export { COMPONENTS_V2_FLAGS }
