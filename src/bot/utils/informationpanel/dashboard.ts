import {
  ActionRowBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import { colors } from "../../config.js"
import { appEmojiComponent, appEmojiHeading, appEmojiOrFallback, appEmojiText, type AppEmojiName } from "../appEmojis.js"
import formatTime from "../formatTime.js"
import parseTime from "../parseTime.js"
import { publishPanel, rescheduleInformationPanel } from "./engine.js"
import {
  FIELD_KEYS,
  FIELD_LABELS,
  clampDescription,
  clampInterval,
  clampTitle,
  getConfig,
  updateConfig,
  type InformationPanelConfig,
} from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

function compactDuration(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}m`
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

function onOff(enabled: boolean): string {
  return enabled ? `${appEmojiText("power")} Activé` : `${appEmojiText("power")} Désactivé`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "Aucun"
}

function previewText(value: string, max = 80): string {
  const one = value.replace(/\s+/g, " ").trim()
  if (!one) return "*Vide*"
  return one.length > max ? `${one.slice(0, max)}…` : one
}

export function buildInformationPanelEmbed(
  name: AppEmojiName,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.prime
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(" ").setDescription(`${appEmojiHeading(name, title)}\n${desc}`)
  if (color) embed.setColor(color)
  return embed
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

function fieldSummary(config: InformationPanelConfig): string {
  const enabled = FIELD_KEYS.filter((key) => config.fields[key])
  if (enabled.length === 0) return "*Aucun*"
  if (enabled.length === FIELD_KEYS.length) return "*Tous*"
  return enabled.map((key) => FIELD_LABELS[key]).join(", ")
}

export function buildInformationPanelContainer(
  _client: Client,
  _guild: Guild,
  config: InformationPanelConfig
): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("pin")} 〃 Panneau d'information`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Liste des informations utiles du serveur, publiée et actualisée dans un salon.*\n\n` +
        `> **État :** ${onOff(config.enabled)}\n` +
        `> ${appEmojiText("file")} **Salon :** ${channelMention(config.channelId)}\n` +
        `> ${appEmojiText("cog")} **Intervalle :** \`${formatTime(config.interval)}\`\n` +
        `> ${appEmojiText("file")} **Titre :** ${previewText(config.title || "*Nom du serveur*")}\n` +
        `> **Champs :** ${fieldSummary(config)}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(config.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("ip_toggle")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon du panneau**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("ip_channel")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId("ip_channel_clear").setEmoji(appEmojiComponent("cancel")).setStyle(ButtonStyle.Danger).setDisabled(!config.channelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Intervalle**\n> \`${formatTime(config.interval)}\``))
      .setButtonAccessory((btn) => btn.setCustomId("ip_interval").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(`**Titre et description**\n> ${previewText(config.title || "*Nom du serveur*")}`)
      )
      .setButtonAccessory((btn) => btn.setCustomId("ip_text").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Publier / actualiser**\n> Envoie ou met à jour le message dans le salon."))
      .setButtonAccessory((btn) =>
        btn.setCustomId("ip_publish").setEmoji(appEmojiComponent("check")).setStyle(ButtonStyle.Success).setDisabled(!config.channelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) =>
    t.setContent(`${appEmojiText("file")} **Champs affichés**\n> ${fieldSummary(config)}`)
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ip_fields")
        .setPlaceholder("Sélectionner les champs à afficher...")
        .setMinValues(0)
        .setMaxValues(FIELD_KEYS.length)
        .addOptions(
          FIELD_KEYS.map((key) => ({
            label: FIELD_LABELS[key],
            value: key,
            default: config.fields[key],
            emoji: appEmojiOrFallback("power"),
          }))
        )
    )
  )
  return [container]
}

function buildIntervalModal(config: InformationPanelConfig): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("interval")
    .setLabel("Intervalle (1m, 5m, 1h, 1d…)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setPlaceholder("5m")
    .setValue(compactDuration(config.interval))
  return new ModalBuilder()
    .setCustomId("ip_modal_interval")
    .setTitle("Intervalle du panneau")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

function buildTextModal(config: InformationPanelConfig): ModalBuilder {
  const title = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Titre (vide = nom du serveur)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256)
    .setPlaceholder("Informations du serveur")
    .setValue(config.title.slice(0, 256))
  const description = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Description (optionnelle)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Quelques infos utiles pour la communauté.")
    .setValue(config.description.slice(0, 1000))
  return new ModalBuilder()
    .setCustomId("ip_modal_text")
    .setTitle("Texte du panneau")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(title),
      new ActionRowBuilder<TextInputBuilder>().addComponents(description)
    )
}

async function refreshPanel(
  client: Client,
  interaction: MessageComponentInteraction | { update: MessageComponentInteraction["update"]; guild: Guild | null },
  guild: Guild
): Promise<void> {
  const config = await getConfig(guild.id)
  await interaction.update({
    components: buildInformationPanelContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export async function handleInformationPanelInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ip_")) return false
  if (!interaction.inGuild()) return false
  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && customId === "ip_interval") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildIntervalModal(config))
    return true
  }

  if (interaction.isButton() && customId === "ip_text") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildTextModal(config))
    return true
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false

    if (customId === "ip_modal_interval") {
      const parsed = parseTime(interaction.fields.getTextInputValue("interval"))
      if (parsed === null || parsed <= 0) {
        await interaction.reply({
          content: "> *Durée invalide. Exemples : `1m`, `5m`, `1h`, `1d`.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const interval = clampInterval(parsed)
      const current = await getConfig(guild.id)
      const nextAt = current.enabled && current.channelId ? Date.now() + interval : current.nextAt
      await updateConfig(guild.id, { $set: { interval, nextAt } })
      await rescheduleInformationPanel(client, guild.id)
      await refreshPanel(client, interaction, guild)
      return true
    }

    if (customId === "ip_modal_text") {
      await updateConfig(guild.id, {
        $set: {
          title: clampTitle(interaction.fields.getTextInputValue("title")),
          description: clampDescription(interaction.fields.getTextInputValue("description")),
        },
      })
      await refreshPanel(client, interaction, guild)
      return true
    }

    return false
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === "ip_toggle") {
    const config = await getConfig(guild.id)
    const enabled = !config.enabled
    const nextAt = enabled && config.channelId ? Date.now() : null
    await updateConfig(guild.id, { $set: { enabled, nextAt } })
    await rescheduleInformationPanel(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "ip_channel_clear") {
    await updateConfig(guild.id, { $set: { channelId: null, messageId: null, nextAt: null } })
    await rescheduleInformationPanel(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "ip_channel" && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({ content: "> *Le salon doit être un salon textuel du serveur.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const current = await getConfig(guild.id)
    const nextAt = current.enabled ? Date.now() : current.nextAt
    await updateConfig(guild.id, { $set: { channelId, messageId: null, nextAt } })
    await rescheduleInformationPanel(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "ip_publish") {
    const result = await publishPanel(client, guild.id)
    if (!result.ok) {
      await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
      return true
    }
    await refreshPanel(client, interaction, guild)
    await interaction
      .followUp({
        content: `> *Panneau publié dans <#${result.config.channelId}>.*`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined)
    return true
  }

  if (customId === "ip_fields" && interaction.isStringSelectMenu()) {
    const selected = new Set(interaction.values)
    const fields = Object.fromEntries(FIELD_KEYS.map((key) => [key, selected.has(key)]))
    await updateConfig(guild.id, { $set: { fields } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  return false
}
