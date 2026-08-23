import {
  ActionRowBuilder,
  ButtonBuilder,
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
  type ModalMessageModalSubmitInteraction,
} from "discord.js"
import { COMPONENTS_V2_FLAGS, buildSimpleTicketEmbed, categoryLabel, publishPanel, republishIfPublished } from "./engine.js"
import {
  MAX_CATEGORIES,
  TICKET_BUTTON_KEYS,
  TICKET_BUTTON_LABELS,
  clampPattern,
  defaultCategory,
  emptyEmbed,
  generateCategoryId,
  getConfig,
  isValidHexColor,
  normalizeEmoji,
  updateConfig,
  type TicketButtonKey,
  type TicketCategory,
  type TicketEmbedConfig,
  type TicketsConfig,
} from "./schema.js"

const CONTAINER_ACCENT = 0x36373e

const EMOJI_IDS = {
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
  channel: "<:Channel:1469692104589705376>",
  check: "<:Check:1469692151251341425>",
  cogUser: "<:CogUser:1469692167122325577>",
  disable: "<:Disable:1469692191298556099>",
  enable: "<:Enable:1469692252988116992>",
  notes: "<:Notes:1469692988870623369>",
  pen: "<:Pen:1469693057497563160>",
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

function roleList(roleIds: string[]): string {
  if (roleIds.length === 0) return "Aucun"
  return roleIds.map((roleId) => `<@&${roleId}>`).join(" ")
}

function previewText(value: string, max = 80): string {
  const one = value.replace(/\s+/g, " ").trim()
  if (!one) return "*Vide*"
  return one.length > max ? `${one.slice(0, max)}…` : one
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

interface CategoryDraft {
  ownerId: string
  editingId: string | null
  data: TicketCategory
  ts: number
}

const DRAFT_TTL = 15 * 60 * 1000
const drafts = new Map<string, CategoryDraft>()

function draftKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`
}

function sweepDrafts(): void {
  const now = Date.now()
  for (const [key, draft] of drafts) {
    if (now - draft.ts > DRAFT_TTL) drafts.delete(key)
  }
}

function setDraft(guildId: string, userId: string, editingId: string | null, data: TicketCategory): CategoryDraft {
  sweepDrafts()
  const draft: CategoryDraft = { ownerId: userId, editingId, data, ts: Date.now() }
  drafts.set(draftKey(guildId, userId), draft)
  return draft
}

function getDraft(guildId: string, userId: string): CategoryDraft | null {
  sweepDrafts()
  return drafts.get(draftKey(guildId, userId)) ?? null
}

function touchDraft(guildId: string, userId: string, data: TicketCategory): CategoryDraft | null {
  const draft = getDraft(guildId, userId)
  if (!draft) return null
  draft.data = data
  draft.ts = Date.now()
  return draft
}

function deleteDraft(guildId: string, userId: string): void {
  drafts.delete(draftKey(guildId, userId))
}

export function buildTicketsPayload(
  _client: Client,
  guild: Guild,
  config: TicketsConfig
): Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder> | ContainerBuilder> {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.notes} 〃 Tickets`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Système de tickets avec catégories personnalisables, claim et logs.*\n\n` +
        `> **Type :** ${config.type === "select" ? "Menu déroulant" : "Boutons"}\n` +
        `> **Claim :** ${onOff(config.claimEnabled)}\n` +
        `> **Boutons additionnels :** ${config.enabledButtons.length}/${TICKET_BUTTON_KEYS.length}\n` +
        `> **Rôle requis :** ${roleMention(config.requiredRoleIds[0] ?? null)}\n` +
        `> **Rôles blacklist :** ${
          config.blacklistRoleIds.length > 0
            ? roleList(config.blacklistRoleIds)
            : "Aucun"
        }\n` +
        `> ${EMOJI_TAGS.channel} **Logs :** ${channelMention(config.logsChannelId)}\n` +
        `> **Catégories :** \`${config.categories.length}/${MAX_CATEGORIES}\``
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Bouton Claim & Type d'ouverture**\n> Claim : ${onOff(config.claimEnabled)} · Type : ${
            config.type === "select" ? "Menu déroulant" : "Boutons"
          }`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("tk_claim_toggle")
          .setEmoji(config.claimEnabled ? emoji("disable") : emoji("enable"))
          .setStyle(config.claimEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId("tk_type")
        .setPlaceholder("Type d'ouverture : Boutons / Menu...")
        .setMaxValues(1)
        .addOptions(
          { label: "Boutons", value: "button", description: "Un bouton par catégorie sous l'embed", emoji: "🔘" },
          { label: "Menu déroulant", value: "select", description: "Un menu de sélection des catégories", emoji: "📋" }
        )
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("tk_role")
        .setPlaceholder("Rôle requis pour ouvrir un ticket...")
        .setMaxValues(1)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("tk_blacklist")
        .setPlaceholder(`Rôles blacklist (${config.blacklistRoleIds.length})...`)
        .setMinValues(0)
        .setMaxValues(10)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("tk_logs")
        .setPlaceholder("Salon des logs de tickets...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText)
    )
  )
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `**Boutons affichés dans les tickets**\n> Claim/Fermer sont toujours présents. Choisissez les boutons additionnels :\n> ${TICKET_BUTTON_KEYS.map(
        (key) => `\`${TICKET_BUTTON_LABELS[key]}\` : ${config.enabledButtons.includes(key) ? EMOJI_TAGS.enable : EMOJI_TAGS.disable}`
      ).join(" · ")}`
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId("tk_buttons")
        .setPlaceholder("Boutons additionnels des tickets...")
        .setMinValues(0)
        .setMaxValues(TICKET_BUTTON_KEYS.length)
        .addOptions(
          TICKET_BUTTON_KEYS.map((key) => ({
            label: TICKET_BUTTON_LABELS[key],
            value: key,
            default: config.enabledButtons.includes(key),
          }))
        )
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId("tk_role_clear")
        .setLabel("Retirer le rôle requis")
        .setEmoji(emoji("disable"))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(config.requiredRoleIds.length === 0),
      new ButtonBuilder()
        .setCustomId("tk_blacklist_clear")
        .setLabel("Vider la blacklist")
        .setEmoji(emoji("disable"))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(config.blacklistRoleIds.length === 0),
      new ButtonBuilder()
        .setCustomId("tk_logs_clear")
        .setLabel("Retirer les logs")
        .setEmoji(emoji("disable"))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!config.logsChannelId)
    )
  )

  const categorySelectRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(buildCategorySelect(guild, config))

  const manageRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("tk_embed").setLabel("Modifier l'embed d'envoi").setEmoji(emoji("pen")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("tk_cat_add").setLabel("Ajouter une catégorie").setEmoji(emoji("enable")).setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("tk_cat_remove")
      .setLabel("Supprimer une catégorie")
      .setEmoji(emoji("disable"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(config.categories.length === 0)
  )

  const sendRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("tk_send")
      .setLabel("Envoyer le panel")
      .setEmoji(emoji("check"))
      .setStyle(ButtonStyle.Success)
  )

  return [container, categorySelectRow, manageRow, sendRow]
}

function buildCategorySelect(guild: Guild, config: TicketsConfig): StringSelectMenuBuilder {
  const select = new StringSelectMenuBuilder()
    .setCustomId("tk_cat_pick")
    .setPlaceholder("Configurer une catégorie...")
    .setMaxValues(1)
  if (config.categories.length === 0) {
    select.addOptions({ label: "Aucune catégorie", value: "none", description: "Ajoutez d'abord une catégorie (bouton vert)" })
  } else {
    select.addOptions(
      config.categories.slice(0, MAX_CATEGORIES).map((category, index) => ({
        label: categoryLabel(guild, category, index),
        value: category.id,
        description: previewText(category.channelNamePattern, 100),
        emoji: { name: category.emoji },
      }))
    )
  }
  return select
}

export function buildEmbedPreview(config: TicketsConfig): EmbedBuilder {
  return buildSimpleTicketEmbed(config.embed, {
    fallbackTitle: "Tickets",
    fallbackDescription: "> *Configurez la description via **Modifier l'embed d'envoi**.*",
  })
}

export function buildEmbedEditorRows(prefix: "tk_emb" | "tk_catemb"): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${prefix}_title`).setLabel("Titre & Description").setEmoji(emoji("notes")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${prefix}_color`).setLabel("Couleur").setEmoji(emoji("cogUser")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${prefix}_footer`).setLabel("Pied de page").setEmoji(emoji("pen")).setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${prefix}_image`).setLabel("Image / Bannière").setEmoji(emoji("channel")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${prefix}_thumb`).setLabel("Miniature").setEmoji(emoji("channel")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${prefix}_reset`).setLabel("Réinitialiser").setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${prefix}_done`).setLabel("Terminé").setEmoji(emoji("check")).setStyle(ButtonStyle.Success)
    ),
  ]
}

function buildEmbedEditorPayload(
  embedData: TicketEmbedConfig,
  prefix: "tk_emb" | "tk_catemb",
  fallbackDescription: string
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  return {
    embeds: [
      buildSimpleTicketEmbed(embedData, {
        fallbackTitle: prefix === "tk_emb" ? "Tickets" : "Ouverture du ticket",
        fallbackDescription,
      }),
    ],
    components: buildEmbedEditorRows(prefix),
  }
}

const PANEL_EMBED_FALLBACK = "> *Configurez la description via **Modifier l'embed d'envoi**.*"
const OPEN_EMBED_FALLBACK = "> *Configurez l'embed affiché à l'ouverture du ticket (titre, description, couleur, image...).* *"

function buildEmbedFieldModal(
  embedData: TicketEmbedConfig,
  action: string,
  modalPrefix: "tk_modal_emb" | "tk_modal_catemb"
): ModalBuilder | null {
  if (action === "title") {
    const title = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("Titre de l'embed")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(256)
      .setValue(embedData.title.slice(0, 256))
    const description = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Description (variables supportées)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(4000)
      .setValue(embedData.description.slice(0, 4000))
    return new ModalBuilder()
      .setCustomId(`${modalPrefix}_title`)
      .setTitle("Titre & Description")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(title),
        new ActionRowBuilder<TextInputBuilder>().addComponents(description)
      )
  }
  if (action === "color") {
    const input = new TextInputBuilder()
      .setCustomId("value")
      .setLabel("Couleur hex (#5865f2, vide = défaut)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(7)
      .setPlaceholder("#5865f2")
      .setValue(embedData.color ?? "")
    return new ModalBuilder()
      .setCustomId(`${modalPrefix}_color`)
      .setTitle("Couleur de l'embed")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
  }
  if (action === "footer") {
    const input = new TextInputBuilder()
      .setCustomId("value")
      .setLabel("Pied de page")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200)
      .setValue(embedData.footer.slice(0, 200))
    return new ModalBuilder()
      .setCustomId(`${modalPrefix}_footer`)
      .setTitle("Pied de page")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
  }
  if (action === "image" || action === "thumb") {
    const input = new TextInputBuilder()
      .setCustomId("value")
      .setLabel(action === "image" ? "URL de l'image / bannière" : "URL de la miniature")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(512)
      .setPlaceholder("https://...")
      .setValue((action === "image" ? embedData.imageUrl : embedData.thumbnailUrl) ?? "")
    return new ModalBuilder()
      .setCustomId(`${modalPrefix}_${action}`)
      .setTitle(action === "image" ? "Image / Bannière" : "Miniature")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
  }
  return null
}

function embedFromModal(
  embedData: TicketEmbedConfig,
  action: string,
  interaction: ModalMessageModalSubmitInteraction
): TicketEmbedConfig | { error: string } {
  const next = { ...embedData }
  if (action === "title") {
    next.title = interaction.fields.getTextInputValue("title").trim().slice(0, 256)
    next.description = interaction.fields.getTextInputValue("description").trim().slice(0, 4000)
    return next
  }
  if (action === "color") {
    const raw = interaction.fields.getTextInputValue("value").trim()
    if (raw && !isValidHexColor(raw)) return { error: "> *Couleur invalide. Utilisez un format hexadécimal : `#5865f2`.*" }
    next.color = raw && isValidHexColor(raw) ? raw.toLowerCase() : null
    return next
  }
  if (action === "footer") {
    next.footer = interaction.fields.getTextInputValue("value").trim().slice(0, 200)
    return next
  }
  if (action === "image" || action === "thumb") {
    const raw = interaction.fields.getTextInputValue("value").trim()
    if (raw && !/^https?:\/\//i.test(raw)) return { error: "> *L'URL doit commencer par `http://` ou `https://`.*" }
    if (action === "image") next.imageUrl = raw || null
    else next.thumbnailUrl = raw || null
    return next
  }
  return { error: "" }
}

export function buildCategoryPayload(draft: CategoryDraft): Array<ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder> | ContainerBuilder> {
  const data = draft.data
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) =>
    t.setContent(`# ${EMOJI_TAGS.pen} 〃 ${draft.editingId ? "Modifier la catégorie" : "Nouvelle catégorie"}`)
  )
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> ${EMOJI_TAGS.channel} **Catégorie Discord :** ${channelMention(data.categoryId)}\n` +
        `> **Emoji :** ${data.emoji}\n` +
        `> **Nom du salon :** \`${previewText(data.channelNamePattern || "{ticketNumber}", 60)}\`\n` +
        `> **Embed d'ouverture :** ${previewText(data.openEmbed.title || data.openEmbed.description, 60)}\n` +
        `> **Rôles staff / accès :** ${roleList(data.staffRoleIds)}\n` +
        `> **Rôles mentionnés :** ${roleList(data.mentionRoleIds)}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("tk_cat_channel")
        .setPlaceholder("Catégorie Discord parente...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildCategory)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Emoji**\n> ${data.emoji} *(unicode uniquement)*`))
      .setButtonAccessory((btn) => btn.setCustomId("tk_cat_emoji").setEmoji(emoji("pen")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Nom du salon**\n> \`${previewText(data.channelNamePattern || "{ticketNumber}", 60)}\``))
      .setButtonAccessory((btn) => btn.setCustomId("tk_cat_name").setEmoji(emoji("pen")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(`**Embed d'ouverture**\n> ${previewText(data.openEmbed.title || data.openEmbed.description, 60)}`)
      )
      .setButtonAccessory((btn) => btn.setCustomId("tk_cat_embed").setEmoji(emoji("pen")).setStyle(ButtonStyle.Secondary))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("tk_cat_staff")
        .setPlaceholder(`Rôles staff / accès (${data.staffRoleIds.length})...`)
        .setMinValues(0)
        .setMaxValues(10)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("tk_cat_mention")
        .setPlaceholder(`Rôles mentionnés à l'ouverture (${data.mentionRoleIds.length})...`)
        .setMinValues(0)
        .setMaxValues(10)
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId("tk_cat_channel_clear")
        .setLabel("Retirer la catégorie")
        .setEmoji(emoji("disable"))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!data.categoryId),
      new ButtonBuilder()
        .setCustomId("tk_cat_staff_clear")
        .setLabel("Retirer les rôles staff")
        .setEmoji(emoji("disable"))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(data.staffRoleIds.length === 0),
      new ButtonBuilder()
        .setCustomId("tk_cat_mention_clear")
        .setLabel("Retirer les mentions")
        .setEmoji(emoji("disable"))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(data.mentionRoleIds.length === 0)
    )
  )

  const bottomRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("tk_cat_save").setLabel("Enregistrer").setEmoji(emoji("check")).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("tk_cat_cancel").setLabel("Annuler").setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger)
  )

  return [container, bottomRow]
}

function buildCategoryModals(draft: CategoryDraft): Record<string, ModalBuilder> {
  const emojiInput = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Emoji (unicode uniquement)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setPlaceholder("🎫")
    .setValue(draft.data.emoji.slice(0, 16))
  const nameInput = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Nom du salon (variables autorisées)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(90)
    .setPlaceholder("{ticketNumber}-{memberDisplayName}")
    .setValue(draft.data.channelNamePattern.slice(0, 90))
  return {
    tk_modal_cat_emoji: new ModalBuilder()
      .setCustomId("tk_modal_cat_emoji")
      .setTitle("Emoji de la catégorie")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput)),
    tk_modal_cat_name: new ModalBuilder()
      .setCustomId("tk_modal_cat_name")
      .setTitle("Nom du salon")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput)),
  }
}

function noticePayload(title: string, body: string, ephemeral = true): { components: ContainerBuilder[]; flags: number } {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.notes} 〃 ${title}`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  if (body) container.addTextDisplayComponents((t) => t.setContent(body))
  return { components: [container], flags: ephemeral ? COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral : COMPONENTS_V2_FLAGS }
}

async function refreshDashboard(client: Client, interaction: MessageComponentInteraction, guild: Guild): Promise<void> {
  const config = await getConfig(guild.id)
  await interaction.update({
    components: buildTicketsPayload(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

async function refreshCategoryPanel(
  interaction: MessageComponentInteraction | ModalMessageModalSubmitInteraction,
  draft: CategoryDraft
): Promise<void> {
  await interaction.update({
    components: buildCategoryPayload(draft),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export async function handleTicketsInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("tk_")) return false
  if (
    customId.startsWith("tk_open:") ||
    customId === "tk_panel_select" ||
    customId === "tk_claim" ||
    customId === "tk_unclaim" ||
    customId === "tk_close"
  ) {
    return false
  }
  if (!interaction.inGuild()) return false
  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  const isMessageComponent = interaction.isMessageComponent()

  if (isMessageComponent && interaction.isStringSelectMenu() && customId === "tk_type") {
    const type = interaction.values[0] === "select" ? "select" : "button"
    await updateConfig(guild.id, { $set: { type } })
    await republishIfPublished(client, guild.id)
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isButton() && customId === "tk_claim_toggle") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { claimEnabled: !config.claimEnabled } })
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isStringSelectMenu() && customId === "tk_buttons") {
    const allowed = new Set<string>(TICKET_BUTTON_KEYS)
    const enabledButtons = interaction.values.filter((v): v is TicketButtonKey => allowed.has(v))
    await updateConfig(guild.id, { $set: { enabledButtons } })
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isRoleSelectMenu() && customId === "tk_role") {
    const roleId = interaction.values[0]
    if (roleId === guild.id) {
      await interaction.reply({
        content: "> *Le rôle @everyone ne peut pas être utilisé comme rôle requis.*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    await updateConfig(guild.id, { $set: { requiredRoleIds: [roleId] } })
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isButton() && customId === "tk_role_clear") {
    await updateConfig(guild.id, { $set: { requiredRoleIds: [] } })
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isRoleSelectMenu() && customId === "tk_blacklist") {
    const roleIds = interaction.values.filter((roleId) => roleId !== guild.id)
    await updateConfig(guild.id, { $set: { blacklistRoleIds: roleIds.slice(0, 10) } })
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isButton() && customId === "tk_blacklist_clear") {
    await updateConfig(guild.id, { $set: { blacklistRoleIds: [] } })
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isChannelSelectMenu() && customId === "tk_logs") {
    const channelId = interaction.values[0]
    await updateConfig(guild.id, { $set: { logsChannelId: channelId } })
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isButton() && customId === "tk_logs_clear") {
    await updateConfig(guild.id, { $set: { logsChannelId: null } })
    await refreshDashboard(client, interaction, guild)
    return true
  }

  if (isMessageComponent && interaction.isButton() && customId === "tk_embed") {
    const config = await getConfig(guild.id)
    await interaction.reply({
      ...buildEmbedEditorPayload(config.embed, "tk_emb", PANEL_EMBED_FALLBACK),
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (isMessageComponent && interaction.isButton() && customId === "tk_cat_embed") {
    const draft = getDraft(guild.id, interaction.user.id)
    if (!draft) return noDraftReply(interaction)
    await interaction.reply({
      ...buildEmbedEditorPayload(draft.data.openEmbed, "tk_catemb", OPEN_EMBED_FALLBACK),
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (isMessageComponent && interaction.isButton() && (customId.startsWith("tk_emb_") || customId.startsWith("tk_catemb_"))) {
    const isCategory = customId.startsWith("tk_catemb_")
    const action = customId.slice(isCategory ? "tk_catemb_".length : "tk_emb_".length)
    if (action === "done") {
      await interaction.deferUpdate()
      await interaction.deleteReply().catch(() => undefined)
      return true
    }
    if (isCategory) {
      const draft = getDraft(guild.id, interaction.user.id)
      if (!draft) return noDraftReply(interaction)
      if (action === "reset") {
        draft.data.openEmbed = emptyEmbed()
        await interaction.update(buildEmbedEditorPayload(draft.data.openEmbed, "tk_catemb", OPEN_EMBED_FALLBACK))
        return true
      }
      const modal = buildEmbedFieldModal(draft.data.openEmbed, action, "tk_modal_catemb")
      if (!modal) return false
      await interaction.showModal(modal)
      return true
    }
    if (action === "reset") {
      await updateConfig(guild.id, {
        $set: {
          "embed.title": "",
          "embed.description": "",
          "embed.color": null,
          "embed.imageUrl": null,
          "embed.thumbnailUrl": null,
          "embed.footer": "",
        },
      })
      const config = await getConfig(guild.id)
      await republishIfPublished(client, guild.id)
      await interaction.update(buildEmbedEditorPayload(config.embed, "tk_emb", PANEL_EMBED_FALLBACK))
      return true
    }
    const config = await getConfig(guild.id)
    const modal = buildEmbedFieldModal(config.embed, action, "tk_modal_emb")
    if (!modal) return false
    await interaction.showModal(modal)
    return true
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false

    if (customId.startsWith("tk_modal_emb_") || customId.startsWith("tk_modal_catemb_")) {
      const isCategory = customId.startsWith("tk_modal_catemb_")
      const action = customId.slice(isCategory ? "tk_modal_catemb_".length : "tk_modal_emb_".length)
      if (isCategory) {
        const draft = getDraft(guild.id, interaction.user.id)
        if (!draft) {
          await interaction.reply({
            content: "> *Session de configuration expirée. Rouvrez le panneau des catégories.*",
            flags: MessageFlags.Ephemeral,
          })
          return true
        }
        const result = embedFromModal(draft.data.openEmbed, action, interaction)
        if ("error" in result) {
          if (result.error) {
            await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
          }
          return true
        }
        draft.data.openEmbed = result
        await interaction.update(buildEmbedEditorPayload(draft.data.openEmbed, "tk_catemb", OPEN_EMBED_FALLBACK))
        return true
      }
      const config = await getConfig(guild.id)
      const result = embedFromModal(config.embed, action, interaction)
      if ("error" in result) {
        if (result.error) {
          await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
        }
        return true
      }
      await updateConfig(guild.id, { $set: { embed: result } })
      await republishIfPublished(client, guild.id)
      await interaction.update(buildEmbedEditorPayload(result, "tk_emb", PANEL_EMBED_FALLBACK))
      return true
    }

    if (customId.startsWith("tk_modal_cat_")) {
      const draft = getDraft(guild.id, interaction.user.id)
      if (!draft) {
        await interaction.reply({
          content: "> *Session de configuration expirée. Rouvrez le panneau des catégories.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const data: TicketCategory = { ...draft.data }
      const field = customId.slice("tk_modal_cat_".length)
      if (field === "emoji") {
        const parsed = normalizeEmoji(interaction.fields.getTextInputValue("value"))
        if (!parsed) {
          await interaction.reply({
            content: "> *Emoji invalide. Seuls les emojis unicode sont acceptés (ex : `🎫`).*",
            flags: MessageFlags.Ephemeral,
          })
          return true
        }
        data.emoji = parsed
      } else if (field === "name") {
        data.channelNamePattern = clampPattern(interaction.fields.getTextInputValue("value")) || "{ticketNumber}"
      }
      const touched = touchDraft(guild.id, interaction.user.id, data)
      if (!touched) return false
      await refreshCategoryPanel(interaction, touched)
      return true
    }

    return false
  }

  if (!isMessageComponent) return false

  if (interaction.isButton() && customId === "tk_send") {
    const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
    container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.channel} 〃 Envoyer le panel`))
    container.addSeparatorComponents((s) => s.setSpacing(1))
    container.addTextDisplayComponents((t) =>
      t.setContent(
        "> *Choisissez le salon où envoyer le panel des tickets.*\n> *Le panel existant sera **mis à jour** si vous choisissez son salon actuel.*"
      )
    )
    await interaction.reply({
      components: [
        container,
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId("tk_send_channel")
            .setPlaceholder("Choisir le salon d'envoi...")
            .setMaxValues(1)
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        ),
      ],
      flags: COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral,
    })
    return true
  }

  if (interaction.isChannelSelectMenu() && customId === "tk_send_channel") {
    const channelId = interaction.values[0]
    const result = await publishPanel(client, guild.id, channelId)
    if (!result.ok) {
      await interaction.update(noticePayload("Envoi impossible", result.error))
      return true
    }
    await interaction.update(
      noticePayload(
        "Panel envoyé",
        `> ${EMOJI_TAGS.check} **Le panel des tickets a été envoyé dans <#${channelId}>.**`
      )
    )
    return true
  }

  if (interaction.isButton() && customId === "tk_cat_add") {
    const config = await getConfig(guild.id)
    if (config.categories.length >= MAX_CATEGORIES) {
      await interaction.reply(noticePayload("Limite atteinte", `> *Maximum de **${MAX_CATEGORIES}** catégories atteint.*`))
      return true
    }
    const draft = setDraft(guild.id, interaction.user.id, null, defaultCategory(generateCategoryId()))
    await interaction.reply({ components: buildCategoryPayload(draft), flags: COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral })
    return true
  }

  if (interaction.isStringSelectMenu() && customId === "tk_cat_pick") {
    const id = interaction.values[0]
    const config = await getConfig(guild.id)
    const category = config.categories.find((entry) => entry.id === id)
    if (!category) {
      await interaction.reply(noticePayload("Introuvable", "> *Cette catégorie n'existe plus.*"))
      return true
    }
    const draft = setDraft(guild.id, interaction.user.id, category.id, { ...category })
    await interaction.reply({ components: buildCategoryPayload(draft), flags: COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral })
    return true
  }

  if (interaction.isButton() && customId === "tk_cat_remove") {
    const config = await getConfig(guild.id)
    if (config.categories.length === 0) {
      await interaction.reply(noticePayload("Aucune catégorie", "> *Ajoutez d'abord une catégorie avec le bouton vert.*"))
      return true
    }
    const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
    container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.disable} 〃 Supprimer des catégories`))
    container.addSeparatorComponents((s) => s.setSpacing(1))
    container.addTextDisplayComponents((t) => t.setContent("> *Sélectionnez les catégories à supprimer.*"))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("tk_cat_remove_pick")
          .setPlaceholder("Catégories à supprimer...")
          .setMinValues(1)
          .setMaxValues(Math.min(config.categories.length, 25))
          .addOptions(
            config.categories.slice(0, MAX_CATEGORIES).map((category, index) => ({
              label: categoryLabel(guild, category, index),
              value: category.id,
              description: previewText(category.openEmbed.description || category.openEmbed.title, 100),
              emoji: { name: category.emoji },
            }))
          )
      )
    )
    await interaction.reply({ components: [container], flags: COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral })
    return true
  }

  if (interaction.isStringSelectMenu() && customId === "tk_cat_remove_pick") {
    const ids = new Set(interaction.values)
    const config = await getConfig(guild.id)
    const removed = config.categories.filter((category) => ids.has(category.id))
    const remaining = config.categories.filter((category) => !ids.has(category.id))
    await updateConfig(guild.id, { $set: { categories: remaining } })
    await republishIfPublished(client, guild.id)
    const lines = removed.map((category) => `> ${category.emoji} \`${category.id}\` supprimée.`).join("\n")
    await interaction.update(noticePayload("Catégories supprimées", lines || "> *Aucune catégorie supprimée.*"))
    return true
  }

  if (interaction.isChannelSelectMenu() && customId === "tk_cat_channel") {
    const draft = getDraft(guild.id, interaction.user.id)
    if (!draft) return noDraftReply(interaction)
    draft.data.categoryId = interaction.values[0] ?? null
    await refreshCategoryPanel(interaction, draft)
    return true
  }

  if (interaction.isRoleSelectMenu() && (customId === "tk_cat_staff" || customId === "tk_cat_mention")) {
    const draft = getDraft(guild.id, interaction.user.id)
    if (!draft) return noDraftReply(interaction)
    if (customId === "tk_cat_staff") draft.data.staffRoleIds = interaction.values.filter((id) => id !== guild.id).slice(0, 10)
    else draft.data.mentionRoleIds = interaction.values.filter((id) => id !== guild.id).slice(0, 10)
    await refreshCategoryPanel(interaction, draft)
    return true
  }

  if (interaction.isButton() && customId === "tk_cat_channel_clear") {
    const draft = getDraft(guild.id, interaction.user.id)
    if (!draft) return noDraftReply(interaction)
    draft.data.categoryId = null
    await refreshCategoryPanel(interaction, draft)
    return true
  }

  if (interaction.isButton() && (customId === "tk_cat_staff_clear" || customId === "tk_cat_mention_clear")) {
    const draft = getDraft(guild.id, interaction.user.id)
    if (!draft) return noDraftReply(interaction)
    if (customId === "tk_cat_staff_clear") draft.data.staffRoleIds = []
    else draft.data.mentionRoleIds = []
    await refreshCategoryPanel(interaction, draft)
    return true
  }

  if (interaction.isButton() && (customId === "tk_cat_emoji" || customId === "tk_cat_name")) {
    const draft = getDraft(guild.id, interaction.user.id)
    if (!draft) return noDraftReply(interaction)
    const modals = buildCategoryModals(draft)
    const modalKey = `tk_modal_cat_${customId.slice("tk_cat_".length)}`
    const modal = modals[modalKey]
    if (!modal) return false
    await interaction.showModal(modal)
    return true
  }

  if (interaction.isButton() && customId === "tk_cat_save") {
    const draft = getDraft(guild.id, interaction.user.id)
    if (!draft) return noDraftReply(interaction)
    const config = await getConfig(guild.id)
    if (draft.editingId) {
      const index = config.categories.findIndex((entry) => entry.id === draft.editingId)
      if (index < 0) {
        await interaction.update(noticePayload("Introuvable", "> *Cette catégorie n'existe plus.*"))
        deleteDraft(guild.id, interaction.user.id)
        return true
      }
      const categories = [...config.categories]
      categories[index] = { ...draft.data, id: draft.editingId }
      await updateConfig(guild.id, { $set: { categories } })
    } else {
      if (config.categories.length >= MAX_CATEGORIES) {
        await interaction.update(noticePayload("Limite atteinte", `> *Maximum de **${MAX_CATEGORIES}** catégories atteint.*`))
        deleteDraft(guild.id, interaction.user.id)
        return true
      }
      await updateConfig(guild.id, { $set: { categories: [...config.categories, draft.data] } })
    }
    deleteDraft(guild.id, interaction.user.id)
    await republishIfPublished(client, guild.id)
    await interaction.update(
      noticePayload(
        "Catégorie enregistrée",
        `> ${EMOJI_TAGS.check} **La catégorie a bien été enregistrée.**\n> *Utilisez **Envoyer le panel** pour publier ou actualiser le message.*`
      )
    )
    return true
  }

  if (interaction.isButton() && customId === "tk_cat_cancel") {
    deleteDraft(guild.id, interaction.user.id)
    await interaction.update(noticePayload("Configuration annulée", `> ${EMOJI_TAGS.disable} **Aucune modification n'a été enregistrée.**`))
    return true
  }

  return false
}

function noDraftReply(interaction: Interaction): boolean {
  if (interaction.isRepliable()) {
    interaction
      .reply({
        content: "> *Session de configuration expirée. Rouvrez le panneau des catégories.*",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined)
  }
  return true
}
