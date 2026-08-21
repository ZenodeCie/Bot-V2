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
import { publishStaffList, republishIfPublished } from "./engine.js"
import {
  MAX_ROLES,
  clampDescription,
  clampTitle,
  getConfig,
  updateConfig,
  type StaffListConfig,
} from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

function onOff(enabled: boolean): string {
  return enabled ? `${appEmojiText("power")} Activé` : `${appEmojiText("power")} Désactivé`
}

function yesNo(value: boolean): string {
  return value ? `${appEmojiText("check")} Oui` : `${appEmojiText("cancel")} Non`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "Aucun"
}

function previewText(value: string, max = 80): string {
  const one = value.replace(/\s+/g, " ").trim()
  if (!one) return "*Vide*"
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function clipLabel(value: string, max = 100): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function roleSummary(guild: Guild, config: StaffListConfig): string {
  if (config.roleIds.length === 0) return "*Aucun*"
  return config.roleIds
    .map((id) => {
      const role = guild.roles.cache.get(id)
      return role ? `${role}` : `\`${id}\``
    })
    .join(", ")
}

export function buildStaffListEmbed(
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

export function buildStaffListContainer(_client: Client, guild: Guild, config: StaffListConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("people")} 〃 Liste du Staff`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Liste automatique du staff, groupée par rôle et actualisée en temps réel.*\n\n` +
        `> **État :** ${onOff(config.enabled)}\n` +
        `> ${appEmojiText("file")} **Salon :** ${channelMention(config.channelId)}\n` +
        `> ${appEmojiText("people")} **Rôles :** ${roleSummary(guild, config)}\n` +
        `> ${appEmojiText("power")} **Statut :** ${config.showStatus ? `${appEmojiText("check")} Affiché` : `${appEmojiText("cancel")} Masqué`}\n` +
        `> ${appEmojiText("people")} **Ignorer les bots :** ${yesNo(config.ignoreBots)}\n` +
        `> ${appEmojiText("file")} **Titre :** ${previewText(config.title || "Liste du Staff")}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(config.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("sl_toggle")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon de la liste**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("sl_channel")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId("sl_channel_clear").setEmoji(appEmojiComponent("cancel")).setStyle(ButtonStyle.Danger).setDisabled(!config.channelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("people")} **Ajouter des rôles staff**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("sl_role_add")
        .setPlaceholder("Ajouter des rôles...")
        .setMinValues(1)
        .setMaxValues(5)
        .setDisabled(config.roleIds.length >= MAX_ROLES)
    )
  )
  if (config.roleIds.length > 0) {
    container.addTextDisplayComponents((t) => t.setContent("**Retirer des rôles**"))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("sl_role_rm")
          .setPlaceholder("Retirer des rôles...")
          .setMinValues(1)
          .setMaxValues(Math.min(config.roleIds.length, 25))
          .addOptions(
            config.roleIds.slice(0, 25).map((id) => {
              const role = guild.roles.cache.get(id)
              return { label: clipLabel(role?.name ?? id), value: id }
            })
          )
      )
    )
  }
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(`**Titre et description**\n> ${previewText(config.title || "Liste du Staff")}`)
      )
      .setButtonAccessory((btn) => btn.setCustomId("sl_text").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Publier / actualiser**\n> Envoie ou met à jour le message dans le salon."))
      .setButtonAccessory((btn) =>
        btn.setCustomId("sl_publish").setEmoji(appEmojiComponent("check")).setStyle(ButtonStyle.Success).setDisabled(!config.channelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Statut en ligne**\n> ${config.showStatus ? `Affiché à côté de chaque membre ${appEmojiText("check")}` : `Masqué ${appEmojiText("cancel")}`}`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("sl_status")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.showStatus ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Ignorer les bots**\n> ${config.ignoreBots ? `Les bots n'apparaissent pas ${appEmojiText("check")}` : `Les bots apparaissent ${appEmojiText("cancel")}`}`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("sl_bots")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.ignoreBots ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  return [container]
}

function buildTextModal(config: StaffListConfig): ModalBuilder {
  const title = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Titre (vide = Liste du Staff)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256)
    .setPlaceholder("Liste du Staff")
    .setValue(config.title.slice(0, 256))
  const description = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Description (optionnelle)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("L'équipe du serveur, mise à jour automatiquement.")
    .setValue(config.description.slice(0, 1000))
  return new ModalBuilder()
    .setCustomId("sl_modal_text")
    .setTitle("Texte de la liste")
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
    components: buildStaffListContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export async function handleStaffListInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("sl_")) return false
  if (!interaction.inGuild()) return false
  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && customId === "sl_text") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildTextModal(config))
    return true
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false
    if (customId !== "sl_modal_text") return false
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

  if (customId === "sl_toggle") {
    const config = await getConfig(guild.id)
    const enabled = !config.enabled
    await updateConfig(guild.id, { $set: { enabled } })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "sl_channel_clear") {
    await updateConfig(guild.id, { $set: { channelId: null, messageId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "sl_channel" && interaction.isChannelSelectMenu()) {
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

  if (customId === "sl_role_add" && interaction.isRoleSelectMenu()) {
    const ids = interaction.values.filter((id) => id !== guild.id)
    if (ids.length === 0) {
      await interaction.reply({ content: "> *Le rôle @everyone ne peut pas être utilisé.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $addToSet: { roleIds: { $each: ids } } })
    const next = await getConfig(guild.id)
    if (next.roleIds.length > MAX_ROLES) {
      await updateConfig(guild.id, { $set: { roleIds: next.roleIds.slice(0, MAX_ROLES) } })
    }
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "sl_role_rm" && interaction.isStringSelectMenu()) {
    await updateConfig(guild.id, { $pullAll: { roleIds: interaction.values } })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "sl_publish") {
    const result = await publishStaffList(client, guild.id)
    if (!result.ok) {
      await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
      return true
    }
    await refreshPanel(client, interaction, guild)
    await interaction
      .followUp({
        content: `> *Liste du staff publiée dans <#${result.config.channelId}>.*`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined)
    return true
  }

  if (customId === "sl_status") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { showStatus: !config.showStatus } })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "sl_bots") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { ignoreBots: !config.ignoreBots } })
    await republishIfPublished(client, guild.id)
    await refreshPanel(client, interaction, guild)
    return true
  }

  return false
}
