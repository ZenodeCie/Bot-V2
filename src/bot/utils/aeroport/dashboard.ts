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
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import {
  Aeroport,
  FOOTER_ICON_LABELS,
  FOOTER_ICONS,
  MEDIA_SOURCE_LABELS,
  MEDIA_SOURCES,
  TARGET_LABELS,
  VIEWS,
  getConfig,
  getTemplate,
  invalidateConfig,
  updateConfig,
  type AeroportConfig,
  type AeroportView,
  type FooterIcon,
  type MediaSource,
  type TemplateTarget,
} from "./schema.js"
import { buildMessagePayload, contextFromMember, parseOptionalColor } from "./messages.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

const EMOJI_IDS = {
  addUser: "1469692085992034387",
  bot: "1469692094342762526",
  channel: "1469692104589705376",
  color: "1469692171706962071",
  disable: "1469692191298556099",
  enable: "1469692252988116992",
  eye: "1469692577384235161",
  leave: "1469692941068009686",
  notes: "1469692988870623369",
  pen: "1469693057497563160",
  people: "1469693090280505458",
  plane: "1469696552934183005",
  cogUser: "1469692167122325577",
} as const

const emoji = (key: keyof typeof EMOJI_IDS): { id: string } => ({ id: EMOJI_IDS[key] })

const EMOJI_TAGS = {
  addUser: "<:AddUser:1469692085992034387>",
  bot: "<:Bot:1469692094342762526>",
  channel: "<:Channel:1469692104589705376>",
  color: "<:Color:1469692171706962071>",
  disable: "<:Disable:1469692191298556099>",
  enable: "<:Enable:1469692252988116992>",
  eye: "<:Eye:1469692577384235161>",
  leave: "<:Leave:1469692941068009686>",
  notes: "<:Notes:1469692988870623369>",
  people: "<:People:1469693090280505458>",
  plane: "<:Plane:1469696552934183005>",
  cogUser: "<:CogUser:1469692167122325577>",
} as const

const VIEW_LABELS: Record<AeroportView, string> = {
  home: "Accueil",
  arrival: "Arrivée",
  departure: "Départ",
  dm: "Message privé",
  autoroles: "Autoroles",
}

function onOff(enabled: boolean): string {
  return enabled ? `${EMOJI_TAGS.enable} Activé` : `${EMOJI_TAGS.disable} Désactivé`
}

function previewText(value: string, max = 80): string {
  const one = value.replace(/\s+/g, " ").trim()
  if (!one) return "*Vide*"
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function clipLabel(value: string, max = 100): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "Aucun"
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

function addViewSelect(container: ContainerBuilder, view: AeroportView): void {
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ap_view")
        .setPlaceholder("Changer de page...")
        .addOptions(
          VIEWS.map((value) => ({
            label: VIEW_LABELS[value],
            value,
            default: value === view,
          }))
        )
    )
  )
}

function buildHomeContainer(config: AeroportConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.plane} 〃 Aéroport`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Messages d'arrivée et de départ des membres, message privé et autoroles.*\n\n` +
        `> ${EMOJI_TAGS.addUser} **Arrivée :** ${onOff(config.arrival.enabled)} — ${channelMention(config.arrival.channelId)}\n` +
        `> ${EMOJI_TAGS.leave} **Départ :** ${onOff(config.departure.enabled)} — ${channelMention(config.departure.channelId)}\n` +
        `> ${EMOJI_TAGS.notes} **MP :** ${onOff(config.dm.enabled)}\n` +
        `> ${EMOJI_TAGS.people} **Autoroles :** ${config.autoroles.length} rôle${config.autoroles.length > 1 ? "s" : ""}\n` +
        `> ${EMOJI_TAGS.bot} **Ignorer les bots :** ${config.ignoreBots ? `${EMOJI_TAGS.enable} Oui` : `${EMOJI_TAGS.disable} Non`}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  addViewSelect(container, "home")
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation arrivée**\n> ${onOff(config.arrival.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("ap_toggle_enabled_arrival")
          .setEmoji(config.arrival.enabled ? emoji("disable") : emoji("enable"))
          .setStyle(config.arrival.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation départ**\n> ${onOff(config.departure.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("ap_toggle_enabled_departure")
          .setEmoji(config.departure.enabled ? emoji("disable") : emoji("enable"))
          .setStyle(config.departure.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Message privé**\n> ${onOff(config.dm.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("ap_toggle_enabled_dm")
          .setEmoji(config.dm.enabled ? emoji("disable") : emoji("enable"))
          .setStyle(config.dm.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Ignorer les bots**\n> ${config.ignoreBots ? `Les bots ne déclenchent pas l'aéroport ${EMOJI_TAGS.enable}` : `Les bots déclenchent l'aéroport ${EMOJI_TAGS.disable}`}`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("ap_toggle_bots")
          .setEmoji(config.ignoreBots ? emoji("enable") : emoji("disable"))
          .setStyle(config.ignoreBots ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon d'arrivée**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("ap_channel_arrival")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon d'arrivée**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("ap_channel_clear_arrival")
          .setEmoji(emoji("disable"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!config.arrival.channelId)
      )
  )
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon de départ**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("ap_channel_departure")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon de départ**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("ap_channel_clear_departure")
          .setEmoji(emoji("disable"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!config.departure.channelId)
      )
  )
  return [container]
}

function buildFlightContainer(config: AeroportConfig, target: TemplateTarget): ContainerBuilder[] {
  const template = getTemplate(config, target)
  const channelId = target === "dm" ? null : config[target].channelId
  const enabled = target === "dm" ? config.dm.enabled : config[target].enabled
  const titleEmoji = target === "arrival" ? EMOJI_TAGS.addUser : target === "departure" ? EMOJI_TAGS.leave : EMOJI_TAGS.notes

  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${titleEmoji} 〃 ${TARGET_LABELS[target]}`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> **État :** ${onOff(enabled)}\n` +
        (target !== "dm" ? `> ${EMOJI_TAGS.channel} **Salon :** ${channelMention(channelId)}\n` : "") +
        `> ${EMOJI_TAGS.color} **Embed :** ${onOff(template.embed.enabled)}\n` +
        `> **Titre :** ${previewText(template.embed.title)}\n` +
        `> **Description :** ${previewText(template.embed.description)}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  addViewSelect(container, target)
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`ap_toggle_enabled_${target}`)
          .setEmoji(enabled ? emoji("disable") : emoji("enable"))
          .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )

  if (target !== "dm") {
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon**`))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`ap_channel_${target}`)
          .setPlaceholder("Choisir le salon...")
          .setMaxValues(1)
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
    )
    container.addSectionComponents((sectionBuilder) =>
      sectionBuilder
        .addTextDisplayComponents((t) => t.setContent("**Retirer le salon**"))
        .setButtonAccessory((btn) =>
          btn.setCustomId(`ap_channel_clear_${target}`).setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger).setDisabled(!channelId)
        )
    )
  }

  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`ap_edit_msg_${target}`).setEmoji(emoji("pen")).setLabel("Message").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ap_edit_style_${target}`).setEmoji(emoji("color")).setLabel("Style").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ap_preview_${target}`).setEmoji(emoji("eye")).setLabel("Aperçu").setStyle(ButtonStyle.Primary)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`ap_toggle_embed_${target}`)
        .setLabel(template.embed.enabled ? "Embed activé" : "Embed désactivé")
        .setEmoji(template.embed.enabled ? emoji("enable") : emoji("disable"))
        .setStyle(template.embed.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ap_toggle_author_${target}`)
        .setLabel(template.embed.author ? "Auteur activé" : "Auteur désactivé")
        .setStyle(template.embed.author ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ap_toggle_timestamp_${target}`)
        .setLabel(template.embed.timestamp ? "Date activée" : "Date désactivée")
        .setStyle(template.embed.timestamp ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.color} **Médias de l'embed**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ap_thumb_${target}`)
        .setPlaceholder("Miniature...")
        .addOptions(
          MEDIA_SOURCES.map((value) => ({
            label: `Miniature — ${MEDIA_SOURCE_LABELS[value]}`,
            value,
            default: template.embed.thumbnail === value,
          }))
        )
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ap_image_${target}`)
        .setPlaceholder("Image...")
        .addOptions(
          MEDIA_SOURCES.map((value) => ({
            label: `Image — ${MEDIA_SOURCE_LABELS[value]}`,
            value,
            default: template.embed.image === value,
          }))
        )
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ap_footericon_${target}`)
        .setPlaceholder("Icône du footer...")
        .addOptions(
          FOOTER_ICONS.map((value) => ({
            label: `Footer — ${FOOTER_ICON_LABELS[value]}`,
            value,
            default: template.embed.footerIcon === value,
          }))
        )
    )
  )
  return [container]
}

function buildAutorolesContainer(guild: Guild, config: AeroportConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.people} 〃 Autoroles`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  const lines =
    config.autoroles.length > 0
      ? config.autoroles.map((id) => {
          const role = guild.roles.cache.get(id)
          return role ? `> ${role}` : `> \`${id}\` *(introuvable)*`
        }).join("\n")
      : "> *Aucun rôle n'est attribué à l'arrivée.*"
  container.addTextDisplayComponents((t) =>
    t.setContent(`> *Ces rôles sont donnés automatiquement à l'arrivée d'un membre.*\n\n${lines}`)
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  addViewSelect(container, "autoroles")
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.cogUser} **Ajouter des rôles**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId("ap_autorole_add").setPlaceholder("Ajouter des rôles...").setMinValues(1).setMaxValues(5)
    )
  )
  if (config.autoroles.length > 0) {
    container.addTextDisplayComponents((t) => t.setContent("**Retirer des rôles**"))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ap_autorole_rm")
          .setPlaceholder("Retirer des rôles...")
          .setMinValues(1)
          .setMaxValues(Math.min(config.autoroles.length, 25))
          .addOptions(
            config.autoroles.slice(0, 25).map((id) => {
              const role = guild.roles.cache.get(id)
              return { label: clipLabel(role?.name ?? id), value: id }
            })
          )
      )
    )
  }
  return [container]
}

export function buildAeroportContainer(
  _client: Client,
  guild: Guild,
  config: AeroportConfig,
  view: AeroportView = "home"
): ContainerBuilder[] {
  if (view === "arrival" || view === "departure" || view === "dm") return buildFlightContainer(config, view)
  if (view === "autoroles") return buildAutorolesContainer(guild, config)
  return buildHomeContainer(config)
}

function isView(value: string): value is AeroportView {
  return (VIEWS as readonly string[]).includes(value)
}

function parseTarget(customId: string): TemplateTarget | null {
  if (customId.includes("arrival")) return "arrival"
  if (customId.includes("departure")) return "departure"
  if (customId.includes("_dm") || customId.endsWith("dm")) return "dm"
  return null
}

function templatePath(target: TemplateTarget): string {
  return target === "dm" ? "dm.template" : `${target}.template`
}

function enabledPath(target: TemplateTarget): string {
  return target === "dm" ? "dm.enabled" : `${target}.enabled`
}

function inputValue(current: string, max: number): string | undefined {
  const clipped = current.slice(0, max)
  return clipped.length > 0 ? clipped : undefined
}

function buildMessageModal(target: TemplateTarget, config: AeroportConfig): ModalBuilder {
  const template = getTemplate(config, target)
  const content = new TextInputBuilder()
    .setCustomId("content")
    .setLabel("Contenu du message")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000)
    .setPlaceholder("Texte au-dessus de l'embed. Variables : {user}, {server}…")
  const contentValue = inputValue(template.content, 2000)
  if (contentValue) content.setValue(contentValue)

  const title = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Titre de l'embed")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256)
    .setPlaceholder("Atterrissage")
  const titleValue = inputValue(template.embed.title, 256)
  if (titleValue) title.setValue(titleValue)

  const description = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Description de l'embed")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder("{user} vient d'atterrir sur **{server}**.")
  const descriptionValue = inputValue(template.embed.description, 4000)
  if (descriptionValue) description.setValue(descriptionValue)

  return new ModalBuilder()
    .setCustomId(`ap_modal_msg_${target}`)
    .setTitle(clipLabel(`Message — ${TARGET_LABELS[target]}`, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(content),
      new ActionRowBuilder<TextInputBuilder>().addComponents(title),
      new ActionRowBuilder<TextInputBuilder>().addComponents(description)
    )
}

function buildStyleModal(target: TemplateTarget, config: AeroportConfig): ModalBuilder {
  const template = getTemplate(config, target)
  const color = new TextInputBuilder()
    .setCustomId("color")
    .setLabel("Couleur (hex)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(7)
    .setPlaceholder("#5865f2")
  const colorValue = inputValue(template.embed.color ?? "", 7)
  if (colorValue) color.setValue(colorValue)

  const footer = new TextInputBuilder()
    .setCustomId("footer")
    .setLabel("Footer")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1024)
    .setPlaceholder("{server}")
  const footerValue = inputValue(template.embed.footer, 1024)
  if (footerValue) footer.setValue(footerValue)

  const imageUrl = new TextInputBuilder()
    .setCustomId("imageUrl")
    .setLabel("URL de l'image")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(400)
    .setPlaceholder("https://…")
  const imageValue = inputValue(template.embed.imageUrl ?? "", 400)
  if (imageValue) imageUrl.setValue(imageValue)

  const thumbnailUrl = new TextInputBuilder()
    .setCustomId("thumbnailUrl")
    .setLabel("URL de la miniature")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(400)
    .setPlaceholder("https://…")
  const thumbValue = inputValue(template.embed.thumbnailUrl ?? "", 400)
  if (thumbValue) thumbnailUrl.setValue(thumbValue)

  return new ModalBuilder()
    .setCustomId(`ap_modal_style_${target}`)
    .setTitle(clipLabel(`Style — ${TARGET_LABELS[target]}`, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(color),
      new ActionRowBuilder<TextInputBuilder>().addComponents(footer),
      new ActionRowBuilder<TextInputBuilder>().addComponents(imageUrl),
      new ActionRowBuilder<TextInputBuilder>().addComponents(thumbnailUrl)
    )
}

async function refreshPanel(
  client: Client,
  interaction: MessageComponentInteraction | { update: MessageComponentInteraction["update"]; guild: Guild | null },
  guild: Guild,
  view: AeroportView
): Promise<void> {
  const config = await getConfig(guild.id)
  await interaction.update({
    components: buildAeroportContainer(client, guild, config, view),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export async function handleAeroportInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ap_")) return false
  if (!interaction.inGuild()) return false
  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && (customId.startsWith("ap_edit_msg_") || customId.startsWith("ap_edit_style_"))) {
    const target = parseTarget(customId)
    if (!target) return false
    const config = await getConfig(guild.id)
    const modal = customId.startsWith("ap_edit_msg_") ? buildMessageModal(target, config) : buildStyleModal(target, config)
    await interaction.showModal(modal)
    return true
  }

  if (interaction.isButton() && customId.startsWith("ap_preview_")) {
    const target = parseTarget(customId)
    if (!target) return false
    const config = await getConfig(guild.id)
    const member = await guild.members.fetch(interaction.user.id).catch(() => null)
    const ctx = member ? contextFromMember(member) : null
    if (!ctx) {
      await interaction.reply({ content: "> *Impossible de générer l'aperçu.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const payload = buildMessagePayload(getTemplate(config, target), ctx)
    if (!payload) {
      await interaction.reply({
        content: "> *Ce message est vide. Ajoutez un contenu ou un embed.*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
    return true
  }

  if (interaction.isModalSubmit()) {
    const target = parseTarget(customId)
    if (!target || !interaction.isFromMessage()) return false
    const prefix = templatePath(target)

    if (customId.startsWith("ap_modal_msg_")) {
      await updateConfig(guild.id, {
        $set: {
          [`${prefix}.content`]: interaction.fields.getTextInputValue("content"),
          [`${prefix}.embed.title`]: interaction.fields.getTextInputValue("title"),
          [`${prefix}.embed.description`]: interaction.fields.getTextInputValue("description"),
        },
      })
      await refreshPanel(client, interaction, guild, target)
      return true
    }

    if (customId.startsWith("ap_modal_style_")) {
      const colorRaw = interaction.fields.getTextInputValue("color").trim()
      if (colorRaw && !parseOptionalColor(colorRaw)) {
        await interaction.reply({
          content: "> *Couleur invalide. Utilisez un hex du type `#5865f2`.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      await updateConfig(guild.id, {
        $set: {
          [`${prefix}.embed.color`]: parseOptionalColor(colorRaw),
          [`${prefix}.embed.footer`]: interaction.fields.getTextInputValue("footer"),
          [`${prefix}.embed.imageUrl`]: interaction.fields.getTextInputValue("imageUrl").trim() || null,
          [`${prefix}.embed.thumbnailUrl`]: interaction.fields.getTextInputValue("thumbnailUrl").trim() || null,
        },
      })
      await refreshPanel(client, interaction, guild, target)
      return true
    }
    return false
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === "ap_view" && interaction.isStringSelectMenu()) {
    const next = interaction.values[0]
    if (!isView(next)) return false
    await refreshPanel(client, interaction, guild, next)
    return true
  }

  if (customId === "ap_toggle_bots") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { ignoreBots: !config.ignoreBots } })
    await refreshPanel(client, interaction, guild, "home")
    return true
  }

  if (customId.startsWith("ap_toggle_enabled_")) {
    const target = parseTarget(customId)
    if (!target) return false
    const config = await getConfig(guild.id)
    const current = target === "dm" ? config.dm.enabled : config[target].enabled
    await updateConfig(guild.id, { $set: { [enabledPath(target)]: !current } })
    await refreshPanel(client, interaction, guild, "home")
    return true
  }

  if (customId.startsWith("ap_toggle_embed_")) {
    const target = parseTarget(customId)
    if (!target) return false
    const template = getTemplate(await getConfig(guild.id), target)
    await updateConfig(guild.id, { $set: { [`${templatePath(target)}.embed.enabled`]: !template.embed.enabled } })
    await refreshPanel(client, interaction, guild, target)
    return true
  }

  if (customId.startsWith("ap_toggle_author_")) {
    const target = parseTarget(customId)
    if (!target) return false
    const template = getTemplate(await getConfig(guild.id), target)
    await updateConfig(guild.id, { $set: { [`${templatePath(target)}.embed.author`]: !template.embed.author } })
    await refreshPanel(client, interaction, guild, target)
    return true
  }

  if (customId.startsWith("ap_toggle_timestamp_")) {
    const target = parseTarget(customId)
    if (!target) return false
    const template = getTemplate(await getConfig(guild.id), target)
    await updateConfig(guild.id, { $set: { [`${templatePath(target)}.embed.timestamp`]: !template.embed.timestamp } })
    await refreshPanel(client, interaction, guild, target)
    return true
  }

  if (customId.startsWith("ap_channel_clear_")) {
    const target = parseTarget(customId)
    if (!target || target === "dm") return false
    await updateConfig(guild.id, { $set: { [`${target}.channelId`]: null } })
    await refreshPanel(client, interaction, guild, "home")
    return true
  }

  if (customId.startsWith("ap_channel_") && interaction.isChannelSelectMenu()) {
    const target = parseTarget(customId)
    if (!target || target === "dm") return false
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({ content: "> *Le salon doit être un salon textuel du serveur.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $set: { [`${target}.channelId`]: channelId } })
    await refreshPanel(client, interaction, guild, "home")
    return true
  }

  if (customId.startsWith("ap_thumb_") && interaction.isStringSelectMenu()) {
    const target = parseTarget(customId)
    const value = interaction.values[0] as MediaSource
    if (!target || !MEDIA_SOURCES.includes(value)) return false
    await updateConfig(guild.id, { $set: { [`${templatePath(target)}.embed.thumbnail`]: value } })
    await refreshPanel(client, interaction, guild, target)
    return true
  }

  if (customId.startsWith("ap_image_") && interaction.isStringSelectMenu()) {
    const target = parseTarget(customId)
    const value = interaction.values[0] as MediaSource
    if (!target || !MEDIA_SOURCES.includes(value)) return false
    await updateConfig(guild.id, { $set: { [`${templatePath(target)}.embed.image`]: value } })
    await refreshPanel(client, interaction, guild, target)
    return true
  }

  if (customId.startsWith("ap_footericon_") && interaction.isStringSelectMenu()) {
    const target = parseTarget(customId)
    const value = interaction.values[0] as FooterIcon
    if (!target || !FOOTER_ICONS.includes(value)) return false
    await updateConfig(guild.id, { $set: { [`${templatePath(target)}.embed.footerIcon`]: value } })
    await refreshPanel(client, interaction, guild, target)
    return true
  }

  if (customId === "ap_autorole_add" && interaction.isRoleSelectMenu()) {
    const ids = interaction.values.filter((id) => id !== guild.id)
    if (ids.length > 0) {
      await Aeroport.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { autoroles: { $each: ids } } }, { upsert: true })
      invalidateConfig(guild.id)
    }
    await refreshPanel(client, interaction, guild, "autoroles")
    return true
  }

  if (customId === "ap_autorole_rm" && interaction.isStringSelectMenu()) {
    await Aeroport.findOneAndUpdate({ guildId: guild.id }, { $pullAll: { autoroles: interaction.values } }, { upsert: true })
    invalidateConfig(guild.id)
    await refreshPanel(client, interaction, guild, "autoroles")
    return true
  }

  return false
}
