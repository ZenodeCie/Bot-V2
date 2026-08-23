import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  StringSelectMenuBuilder,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import { PUNISHMENT_LABELS, type Punishment } from "../../antiraid/schema.js"
import { appEmojiComponent, appEmojiHeading, appEmojiText } from "../../appEmojis.js"
import formatTime from "../../formatTime.js"
import { ModerationConfig, getModerationConfig } from "../../moderation/schema.js"
import {
  BLACKLIST_PUNISHMENTS,
  BlacklistConfig,
  getConfig as getBlacklistConfig,
  type BlacklistPunishment,
} from "../../blacklist/schema.js"
import { COMPONENTS_V2_FLAGS, CONTAINER_ACCENT } from "../components.js"
import { CFG_BACK, CFG_BL_CHANNEL, CFG_BL_PUNISH, CFG_BL_TOGGLE, CFG_ML_CHANNEL, CFG_ML_OFF } from "../constants.js"
import { appendBackButton, configUpdatePayload } from "../components.js"

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "*Aucun*"
}

function onOff(enabled: boolean): string {
  return enabled ? `${appEmojiText("check")} Activé` : `${appEmojiText("cancel")} Désactivé`
}

export async function buildModlogContainer(_client: Client, guild: Guild): Promise<ContainerBuilder[]> {
  const modConfig = await getModerationConfig(guild.id)
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading("file", "Logs de modération")))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Salon où sont enregistrées les actions de modération (ban, kick, warn, etc.).*\n\n` +
        `> ${appEmojiText("file")} **Salon actuel :** ${channelMention(modConfig.logChannelId)}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CFG_ML_CHANNEL)
        .setPlaceholder("Choisir le salon de logs...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  if (modConfig.logChannelId) {
    container.addActionRowComponents((row) =>
      row.setComponents(
        new ButtonBuilder()
          .setCustomId(CFG_ML_OFF)
          .setLabel("Désactiver les logs")
          .setEmoji(appEmojiComponent("cancel"))
          .setStyle(ButtonStyle.Danger)
      )
    )
  }
  return [container]
}

export async function buildBlacklistContainer(_client: Client, guild: Guild): Promise<ContainerBuilder[]> {
  const blConfig = await getBlacklistConfig(guild.id)
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading("cancel", "Blacklist")))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Sanction automatique des membres présents en blacklist à leur arrivée.*\n\n` +
        `> **État :** ${onOff(blConfig.enabled)}\n` +
        `> **Sanction :** ${PUNISHMENT_LABELS[blConfig.punishment as Punishment] ?? blConfig.punishment}\n` +
        `> **Durée :** ${blConfig.duration > 0 ? formatTime(blConfig.duration) : "—"}\n` +
        `> ${appEmojiText("file")} **Salon de logs :** ${channelMention(blConfig.logChannel)}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) => t.setContent("**Activer / Désactiver**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(CFG_BL_TOGGLE)
          .setEmoji(appEmojiComponent(blConfig.enabled ? "power" : "check"))
          .setStyle(blConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("settings")} **Sanction au join**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CFG_BL_PUNISH)
        .setPlaceholder("Choisir la sanction...")
        .addOptions(
          BLACKLIST_PUNISHMENTS.map((p: BlacklistPunishment) => ({
            label: PUNISHMENT_LABELS[p as Punishment] ?? p,
            value: p,
            default: blConfig.punishment === p,
          }))
        )
    )
  )
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon de logs**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CFG_BL_CHANNEL)
        .setPlaceholder("Choisir le salon de logs...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  return [container]
}

import { requireAdministrator } from "../access.js"

async function refreshModlog(interaction: MessageComponentInteraction, client: Client, guild: Guild) {
  const panels = await buildModlogContainer(client, guild)
  await interaction.update(configUpdatePayload(appendBackButton(panels, CFG_BACK)))
}

async function refreshBlacklist(interaction: MessageComponentInteraction, client: Client, guild: Guild) {
  const panels = await buildBlacklistContainer(client, guild)
  await interaction.update(configUpdatePayload(appendBackButton(panels, CFG_BACK)))
}

export async function handleModerationPanelInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false

  const { customId } = interaction
  if (![CFG_ML_CHANNEL, CFG_ML_OFF, CFG_BL_TOGGLE, CFG_BL_PUNISH, CFG_BL_CHANNEL].includes(customId)) return false
  if (!(await requireAdministrator(interaction))) return true

  const guild = interaction.guild!

  if (customId === CFG_ML_CHANNEL && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null
    await ModerationConfig.updateOne({ guildId: guild.id }, { $set: { logChannelId: channelId } }, { upsert: true })
    await refreshModlog(interaction, client, guild)
    return true
  }

  if (customId === CFG_ML_OFF) {
    await ModerationConfig.updateOne({ guildId: guild.id }, { $set: { logChannelId: null } }, { upsert: true })
    await refreshModlog(interaction, client, guild)
    return true
  }

  if (customId === CFG_BL_TOGGLE) {
    const blConfig = await getBlacklistConfig(guild.id)
    await BlacklistConfig.findOneAndUpdate({ guildId: guild.id }, { enabled: !blConfig.enabled }, { upsert: true })
    await refreshBlacklist(interaction, client, guild)
    return true
  }

  if (customId === CFG_BL_PUNISH && interaction.isStringSelectMenu()) {
    const punishment = interaction.values[0]
    if (punishment && (BLACKLIST_PUNISHMENTS as readonly string[]).includes(punishment)) {
      await BlacklistConfig.findOneAndUpdate({ guildId: guild.id }, { punishment }, { upsert: true })
    }
    await refreshBlacklist(interaction, client, guild)
    return true
  }

  if (customId === CFG_BL_CHANNEL && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null
    await BlacklistConfig.findOneAndUpdate({ guildId: guild.id }, { logChannel: channelId }, { upsert: true })
    await refreshBlacklist(interaction, client, guild)
    return true
  }

  return false
}
