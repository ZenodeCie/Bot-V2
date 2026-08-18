import {
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import { colors } from "../../config.js"
import {
  EVENT_HINTS,
  EVENT_KEYS,
  EVENT_LABELS,
  getConfig,
  updateConfig,
  type EventKey,
  type LogsConfig,
} from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

const EMOJI_IDS = {
  bot: "1469692094342762526",
  channel: "1469692104589705376",
  check: "1469692151251341425",
  cog: "1469692155680526427",
  disable: "1469692191298556099",
  enable: "1469692252988116992",
  notes: "1469692988870623369",
} as const

const emoji = (key: keyof typeof EMOJI_IDS): { id: string } => ({ id: EMOJI_IDS[key] })

const EMOJI_TAGS = {
  bot: "<:Bot:1469692094342762526>",
  channel: "<:Channel:1469692104589705376>",
  check: "<:Check:1469692151251341425>",
  cog: "<:Cog:1469692155680526427>",
  disable: "<:Disable:1469692191298556099>",
  enable: "<:Enable:1469692252988116992>",
  notes: "<:Notes:1469692988870623369>",
} as const

function onOff(enabled: boolean): string {
  return enabled ? `${EMOJI_TAGS.enable} Activé` : `${EMOJI_TAGS.disable} Désactivé`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "*Aucun*"
}

export function buildLogsEmbed(
  emojiChar: string,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.prime
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(" ").setDescription(`# \`${emojiChar}\` 〃 ${title}\n${desc}`)
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

function eventSummary(config: LogsConfig): string {
  const enabled = EVENT_KEYS.filter((key) => config.events[key])
  if (enabled.length === 0) return "*Aucune*"
  if (enabled.length === EVENT_KEYS.length) return "*Toutes*"
  return enabled.map((key) => EVENT_LABELS[key]).join(", ")
}

export function buildGuildLogsContainer(_client: Client, _guild: Guild, config: LogsConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.notes} 〃 Logs`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Les événements du serveur sont envoyés dans un salon. Choisissez les catégories à journaliser.*\n\n` +
        `> ***État :** ${onOff(config.enabled)}*\n` +
        `> ${EMOJI_TAGS.channel} ***Salon :** ${channelMention(config.channelId)}*\n` +
        `> ${EMOJI_TAGS.notes} ***Catégories :** ${eventSummary(config)}*\n` +
        `> ${EMOJI_TAGS.bot} ***Ignorer les bots :** ${config.ignoreBots ? `${EMOJI_TAGS.enable} Oui` : `${EMOJI_TAGS.disable} Non`}*\n` +
        `> ${EMOJI_TAGS.cog} ***Salons ignorés :** ${
          config.ignoredChannels.length > 0 ? config.ignoredChannels.map((id) => `<#${id}>`).join(" ") : "*Aucun*"
        }*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(config.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("lg_toggle")
          .setEmoji(config.enabled ? emoji("disable") : emoji("enable"))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon de logs**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("lg_channel")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId("lg_channel_clear").setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger).setDisabled(!config.channelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.notes} **Catégories à journaliser**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId("lg_events")
        .setPlaceholder("Sélectionner les catégories...")
        .setMinValues(0)
        .setMaxValues(EVENT_KEYS.length)
        .addOptions(
          EVENT_KEYS.map((key) => ({
            label: EVENT_LABELS[key],
            description: EVENT_HINTS[key].slice(0, 100),
            value: key,
            default: config.events[key],
          }))
        )
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Tout activer**"))
      .setButtonAccessory((btn) => btn.setCustomId("lg_all_on").setEmoji(emoji("enable")).setStyle(ButtonStyle.Success))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Tout désactiver**"))
      .setButtonAccessory((btn) => btn.setCustomId("lg_all_off").setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Ignorer les bots**\n> ${
            config.ignoreBots
              ? `Les actions des bots ne sont pas journalisées ${EMOJI_TAGS.enable}`
              : `Les actions des bots sont journalisées ${EMOJI_TAGS.disable}`
          }`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("lg_bots")
          .setEmoji(config.ignoreBots ? emoji("enable") : emoji("disable"))
          .setStyle(config.ignoreBots ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.cog} **Salons ignorés**`))
  container.addActionRowComponents((row) => {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId("lg_ignore")
      .setPlaceholder("Salons à ignorer...")
      .setMinValues(0)
      .setMaxValues(25)
    if (config.ignoredChannels.length) select.setDefaultChannels(config.ignoredChannels.slice(0, 25))
    return row.setComponents(select)
  })
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer les salons ignorés**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("lg_ignore_clear")
          .setEmoji(emoji("disable"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(config.ignoredChannels.length === 0)
      )
  )
  return [container]
}

async function refreshPanel(
  client: Client,
  interaction: MessageComponentInteraction,
  guild: Guild
): Promise<void> {
  const config = await getConfig(guild.id)
  await interaction.update({
    components: buildGuildLogsContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

function eventsUpdate(keys: Iterable<EventKey>, enabled: boolean): Record<string, unknown> {
  const events = Object.fromEntries(EVENT_KEYS.map((key) => [key, enabled])) as Record<EventKey, boolean>
  for (const key of keys) events[key] = enabled
  return { events }
}

export async function handleGuildLogsInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  const customId = interaction.customId
  if (!customId.startsWith("lg_")) return false
  if (!interaction.inGuild()) return false
  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (customId === "lg_toggle") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { enabled: !config.enabled } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lg_channel_clear") {
    await updateConfig(guild.id, { $set: { channelId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lg_channel" && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({ content: "> *Le salon doit être un salon textuel du serveur.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $set: { channelId } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lg_events" && interaction.isStringSelectMenu()) {
    const selected = new Set(interaction.values)
    const events = Object.fromEntries(EVENT_KEYS.map((key) => [key, selected.has(key)]))
    await updateConfig(guild.id, { $set: { events } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lg_all_on") {
    await updateConfig(guild.id, { $set: eventsUpdate(EVENT_KEYS, true) })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lg_all_off") {
    await updateConfig(guild.id, { $set: eventsUpdate(EVENT_KEYS, false) })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lg_bots") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { ignoreBots: !config.ignoreBots } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lg_ignore" && interaction.isChannelSelectMenu()) {
    await updateConfig(guild.id, { $set: { ignoredChannels: interaction.values.slice(0, 25) } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lg_ignore_clear") {
    await updateConfig(guild.id, { $set: { ignoredChannels: [] } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  return false
}
