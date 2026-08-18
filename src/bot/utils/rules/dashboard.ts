import {
  ActionRowBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import { colors } from "../../config.js"
import { handleAcceptInteraction, publishRules, republishIfPublished } from "./engine.js"
import { clampDescription, clampTitle, getConfig, updateConfig, type RulesConfig } from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

const EMOJI_IDS = {
  bot: "1469692094342762526",
  channel: "1469692104589705376",
  check: "1469692151251341425",
  cogUser: "1469692167122325577",
  disable: "1469692191298556099",
  enable: "1469692252988116992",
  notes: "1469692988870623369",
  pen: "1469693057497563160",
} as const

const emoji = (key: keyof typeof EMOJI_IDS): { id: string } => ({ id: EMOJI_IDS[key] })

const EMOJI_TAGS = {
  bot: "<:Bot:1469692094342762526>",
  channel: "<:Channel:1469692104589705376>",
  check: "<:Check:1469692151251341425>",
  cogUser: "<:CogUser:1469692167122325577>",
  disable: "<:Disable:1469692191298556099>",
  enable: "<:Enable:1469692252988116992>",
  notes: "<:Notes:1469692988870623369>",
} as const

function onOff(enabled: boolean): string {
  return enabled ? `${EMOJI_TAGS.enable} Activé` : `${EMOJI_TAGS.disable} Désactivé`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "Aucun"
}

function roleMention(roleId: string | null): string {
  return roleId ? `<@&${roleId}>` : "Aucun"
}

function previewText(value: string, max = 80): string {
  const one = value.replace(/\s+/g, " ").trim()
  if (!one) return "*Vide*"
  return one.length > max ? `${one.slice(0, max)}…` : one
}

export function buildRulesEmbed(
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

export function buildRulesContainer(_client: Client, _guild: Guild, config: RulesConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.notes} 〃 Règlement`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Affiche un règlement personnalisable avec un bouton de validation.*\n\n` +
        `> **État :** ${onOff(config.enabled)}\n` +
        `> ${EMOJI_TAGS.channel} **Salon :** ${channelMention(config.channelId)}\n` +
        `> ${EMOJI_TAGS.cogUser} **Rôle :** ${roleMention(config.roleId)}\n` +
        `> ${EMOJI_TAGS.bot} **Ignorer les bots :** ${config.ignoreBots ? `${EMOJI_TAGS.enable} Oui` : `${EMOJI_TAGS.disable} Non`}\n` +
        `> ${EMOJI_TAGS.notes} **Titre :** ${previewText(config.title || "Règlement")}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(config.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("rl_toggle")
          .setEmoji(config.enabled ? emoji("disable") : emoji("enable"))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon du règlement**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("rl_channel")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId("rl_channel_clear").setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger).setDisabled(!config.channelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.cogUser} **Rôle après validation**`))
  container.addActionRowComponents((row) =>
    row.setComponents(new RoleSelectMenuBuilder().setCustomId("rl_role").setPlaceholder("Choisir le rôle...").setMaxValues(1))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le rôle**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId("rl_role_clear").setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger).setDisabled(!config.roleId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Titre et règlement**\n> ${previewText(config.title || "Règlement")}`))
      .setButtonAccessory((btn) => btn.setCustomId("rl_text").setEmoji(emoji("pen")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Publier / actualiser**\n> Envoie ou met à jour le message dans le salon."))
      .setButtonAccessory((btn) =>
        btn.setCustomId("rl_publish").setEmoji(emoji("check")).setStyle(ButtonStyle.Success).setDisabled(!config.channelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Ignorer les bots**\n> ${config.ignoreBots ? `Les bots ne peuvent pas valider ${EMOJI_TAGS.enable}` : `Les bots peuvent valider ${EMOJI_TAGS.disable}`}`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("rl_bots")
          .setEmoji(config.ignoreBots ? emoji("enable") : emoji("disable"))
          .setStyle(config.ignoreBots ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  return [container]
}

function buildTextModal(config: RulesConfig): ModalBuilder {
  const title = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Titre (vide = Règlement)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256)
    .setPlaceholder("Règlement")
    .setValue(config.title.slice(0, 256))
  const description = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Texte du règlement")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder("Rédigez les règles du serveur.")
    .setValue(config.description.slice(0, 4000))
  return new ModalBuilder()
    .setCustomId("rl_modal_text")
    .setTitle("Texte du règlement")
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
    components: buildRulesContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export async function handleRulesInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("rl_")) return false
  if (!interaction.inGuild()) return false

  if (customId === "rl_accept") {
    return handleAcceptInteraction(client, interaction)
  }

  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && customId === "rl_text") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildTextModal(config))
    return true
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false
    if (customId !== "rl_modal_text") return false
    await updateConfig(guild.id, {
      $set: {
        title: clampTitle(interaction.fields.getTextInputValue("title")),
        description: clampDescription(interaction.fields.getTextInputValue("description")),
      },
    })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === "rl_toggle") {
    const config = await getConfig(guild.id)
    const enabled = !config.enabled
    await updateConfig(guild.id, { $set: { enabled } })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "rl_channel_clear") {
    await updateConfig(guild.id, { $set: { channelId: null, messageId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "rl_channel" && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({ content: "> *Le salon doit être un salon textuel du serveur.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $set: { channelId, messageId: null } })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "rl_role_clear") {
    await updateConfig(guild.id, { $set: { roleId: null } })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "rl_role" && interaction.isRoleSelectMenu()) {
    const roleId = interaction.values[0]
    if (roleId === guild.id) {
      await interaction.reply({ content: "> *Le rôle @everyone ne peut pas être utilisé.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $set: { roleId } })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "rl_publish") {
    const result = await publishRules(client, guild.id)
    if (!result.ok) {
      await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
      return true
    }
    await refreshPanel(client, interaction, guild)
    await interaction
      .followUp({
        content: `> *Règlement publié dans <#${result.config.channelId}>.*`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined)
    return true
  }

  if (customId === "rl_bots") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { ignoreBots: !config.ignoreBots } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  return false
}
