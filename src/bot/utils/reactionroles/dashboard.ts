import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js"
import parseTime from "../parseTime.js"
import { appEmojiComponent, appEmojiHeading, appEmojiText } from "../appEmojis.js"
import { messageHasConfigHubMarker, requireAdministrator } from "../configHub/access.js"
import { CFG_BACK } from "../configHub/constants.js"
import { appendBackButton, configUpdatePayload, CONTAINER_ACCENT } from "../configHub/components.js"
import {
  PANEL_LANGUAGES,
  PANEL_LIMITS,
  PANEL_MODES,
  defaultEntry,
  defaultPanel,
  emojiDisplay,
  isPanelLanguage,
  isPanelMode,
  isSnowflake,
  parseEmojiToken,
  type PanelMode,
  type RolePanel,
  type RolePanelEntry,
} from "./schema.js"
import type { ReactionRolesEngine } from "./engine.js"
import { applyTemplate, panelTemplates } from "./templates.js"
import { publishPanel } from "./render.js"
import { formatDurationMs } from "./messages.js"

/**
 * Panneau de configuration administratif des rôles-réactions.
 * Ids : `rr_cfg_*` (composants) / `rr_modal_*` (modals).
 * Fonctionne en standalone (entrée /rr panel / /rr edit) et dans le hub /config.
 */

const PREFIX = "rr_cfg_"
const MODAL_PREFIX = "rr_modal_"
const MODAL_NEW = `${MODAL_PREFIX}new`

const MODE_LABELS: Record<PanelMode, string> = {
  normal: "Normal (toggle)",
  unique: "Unique (un seul rôle)",
  verify: "Vérification (ajout seul)",
  drop: "Drop (retrait)",
  reversed: "Inversé (réaction = retrait)",
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  reaction: "Réaction",
  button: "Bouton",
  select: "Menu",
}

function clip(value: string, max: number): string {
  const text = value.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function onOff(enabled: boolean): string {
  return enabled ? `${appEmojiText("check")} Activé` : `${appEmojiText("cancel")} Désactivé`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "*Aucun*"
}

function roleMentions(ids: string[]): string {
  if (ids.length === 0) return "*Aucun*"
  return ids.map((id) => `<@&${id}>`).join(" ")
}

function dur(ms: number | null): string {
  return ms !== null ? formatDurationMs(ms) : "—"
}

function messageLink(panel: RolePanel): string {
  if (!panel.channelId || !panel.messageId) return "*Non publié*"
  return `[voir](https://discord.com/channels/${panel.guildId}/${panel.channelId}/${panel.messageId})`
}

function entryCountLine(panel: RolePanel): string {
  const counts = { reaction: 0, button: 0, select: 0 }
  for (const entry of panel.entries) counts[entry.entryType] += 1
  return `${panel.entries.length} (${counts.reaction} réaction${counts.reaction > 1 ? "s" : ""}, ${counts.button} bouton${counts.button > 1 ? "s" : ""}, ${counts.select} menu${counts.select > 1 ? "s" : ""})`
}

// ---------------------------------------------------------------------------
// Vues (ContainerBuilder)
// ---------------------------------------------------------------------------

export async function buildReactionRolesHome(client: Client, guild: Guild): Promise<ContainerBuilder[]> {
  const engine = client.reactionroles
  const panels = await engine.getPanels(guild.id)
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading("people", "Rôles-réactions")))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Panels de rôles par réactions, boutons ou menus.*\n` +
        `> *Créez un panel, ajoutez des entrées, puis **publiez-le** dans un salon.*\n\n` +
        `> ${appEmojiText("cog")} **Panels :** \`${panels.length}\``
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  if (panels.length === 0) {
    container.addTextDisplayComponents((t) => t.setContent(`> *Aucun panel. Créez-en un.*`))
  } else {
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}open`)
          .setPlaceholder("Ouvrir un panel...")
          .addOptions(
            panels.slice(0, 25).map((panel) => ({
              label: clip(panel.name || panel.id, 100) || "Panel",
              description: `${MODE_LABELS[panel.mode]} · ${panel.enabled ? "Activé" : "Désactivé"} · ${panel.entries.length} entrées`,
              value: panel.id,
            }))
          )
      )
    )
  }

  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}new`)
        .setLabel("Créer un panel")
        .setEmoji(appEmojiComponent("add"))
        .setStyle(ButtonStyle.Success)
    )
  )

  const summary = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  summary.addTextDisplayComponents((t) =>
    t.setContent(
      `> ${appEmojiText("file")} **Total :** ${panels.length} · ` +
        `**Publiés :** ${panels.filter((panel) => panel.messageId !== null).length}`
    )
  )
  return [container, summary]
}

export async function buildReactionRolesEditor(client: Client, guild: Guild, panel: RolePanel): Promise<ContainerBuilder[]> {
  return buildEditorContainers(client, client.reactionroles, guild, panel)
}

async function buildEditorContainers(_client: Client, _engine: ReactionRolesEngine, _guild: Guild, panel: RolePanel): Promise<ContainerBuilder[]> {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) =>
    t.setContent(appEmojiHeading("settings", `${clip(panel.name || "Panel", 40)} — ${MODE_LABELS[panel.mode]}`))
  )
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> **État :** ${onOff(panel.enabled)} · **Langue :** ${panel.language === "en" ? "English" : "Français"}\n` +
        `> **Publié :** ${channelMention(panel.channelId)} · ${messageLink(panel)}\n` +
        `> **Logs :** ${channelMention(panel.logChannelId)} · **Limite :** ${panel.maxRoles ?? "—"} rôles · **Cooldown :** ${dur(panel.cooldownMs)}\n` +
        `> **DM :** ${panel.dmNotify ? "Oui" : "Non"} · **Rôles dangereux :** ${panel.allowDangerousRoles ? "Autorisés" : "Bloqués"}\n` +
        `> ${appEmojiText("people")} **Entrées :** ${entryCountLine(panel)}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}pub:${panel.id}`).setLabel("Publier").setEmoji(appEmojiComponent("pin")).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}rep:${panel.id}`).setLabel("Republier").setEmoji(appEmojiComponent("loop")).setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}tgl:${panel.id}`)
        .setLabel(panel.enabled ? "Désactiver" : "Activer")
        .setEmoji(appEmojiComponent("power"))
        .setStyle(panel.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}del:${panel.id}`).setLabel("Supprimer").setEmoji(appEmojiComponent("cancel")).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}home`).setLabel("Retour").setEmoji(appEmojiComponent("file")).setStyle(ButtonStyle.Secondary)
    )
  )

  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon de publication**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}chan:${panel.id}`)
        .setPlaceholder("Choisir le salon de publication...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )

  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon de logs**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}logs:${panel.id}`)
        .setPlaceholder("Choisir le salon de logs...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )

  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}mode:${panel.id}`)
        .setPlaceholder(`Mode : ${MODE_LABELS[panel.mode]}`)
        .addOptions(
          PANEL_MODES.map((mode) => ({
            label: MODE_LABELS[mode],
            description: "Comportement des réactions / boutons / menus",
            value: mode,
          }))
        )
    )
  )

  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}lang:${panel.id}`)
        .setPlaceholder(`Langue : ${panel.language === "en" ? "English" : "Français"}`)
        .addOptions(PANEL_LANGUAGES.map((language) => ({ label: language === "en" ? "English" : "Français", value: language })))
    )
  )

  container.addTextDisplayComponents((t) => t.setContent(`> ${appEmojiText("settings")} **Modèle de départ** *(remplace embed, textes et entrées)*`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}tpl:${panel.id}`)
        .setPlaceholder("Appliquer un modèle...")
        .addOptions(panelTemplates(panel.language).map((template) => ({ label: clip(template.name, 90), value: template.key })))
    )
  )

  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}name:${panel.id}`).setLabel("Nom").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}emb1:${panel.id}`).setLabel("Embed").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}emb2:${panel.id}`).setLabel("Author / Champs").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}res1:${panel.id}`).setLabel("Textes A").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}res2:${panel.id}`).setLabel("Textes B").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary)
    )
  )

  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}res3:${panel.id}`).setLabel("Textes C").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}lim:${panel.id}`).setLabel("Limites").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}dm:${panel.id}`)
        .setLabel(panel.dmNotify ? "DM : Oui" : "DM : Non")
        .setStyle(panel.dmNotify ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}dgr:${panel.id}`)
        .setLabel(panel.allowDangerousRoles ? "Danger : Oui" : "Danger : Non")
        .setStyle(panel.allowDangerousRoles ? ButtonStyle.Danger : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}clear:${panel.id}`).setLabel("Logs : vide").setEmoji(appEmojiComponent("cancel")).setStyle(ButtonStyle.Secondary)
    )
  )

  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`**Entrées** — sélectionnez pour éditer, ou ajoutez-en une.`))

  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}addr:${panel.id}`).setLabel("+ Réaction").setEmoji(appEmojiComponent("add")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}addb:${panel.id}`).setLabel("+ Bouton").setEmoji(appEmojiComponent("add")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}adds:${panel.id}`).setLabel("+ Menu").setEmoji(appEmojiComponent("add")).setStyle(ButtonStyle.Success)
    )
  )

  if (panel.entries.length > 0) {
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}entr:${panel.id}`)
          .setPlaceholder("Éditer une entrée...")
          .addOptions(
            panel.entries.slice(0, 25).map((entry, index) => ({
              label: `${index + 1}. ${clip(entry.label || "(sans nom)", 24)}`,
              description: `${entry.roles.length} rôle(s) · ${entry.enabled ? "activée" : "désactivée"}`,
              value: entry.id,
            }))
          )
      )
    )
  }

  return [container]
}

function buildEntryContainers(_client: Client, _engine: ReactionRolesEngine, panel: RolePanel, entry: RolePanelEntry): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) =>
    t.setContent(
      appEmojiHeading("people", `Entrée — ${clip(entry.label || "(sans nom)", 40)} (${ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType})`)
    )
  )
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> **Activée :** ${onOff(entry.enabled)} · **Style bouton :** \`${entry.style}\`\n` +
        `> **Emoji :** ${entry.emoji ? emojiDisplay(entry.emoji) : "*Aucun*"}\n` +
        `> ${appEmojiText("people")} **Rôles :** ${roleMentions(entry.roles)}\n` +
        `> ${appEmojiText("cancel")} **Rôles retirés à l'activation :** ${roleMentions(entry.removeRoles)}\n` +
        `> **Durée :** ${dur(entry.durationMs)}\n` +
        `> **Requis :** ${roleMentions(entry.requiredRoles)} · **Interdits :** ${roleMentions(entry.deniedRoles)}\n` +
        `> **Âge compte :** ${dur(entry.minAccountAgeMs)} · **Âge membre :** ${dur(entry.minMemberAgeMs)}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addTextDisplayComponents((t) => t.setContent(`**Editer** — rôles listés par ID ou mention (\`<@&…>\`), séparés par virgule ou espace.`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}ecnt:${panel.id}:${entry.id}`).setLabel("Contenu").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}erole:${panel.id}:${entry.id}`).setLabel("Rôles").setEmoji(appEmojiComponent("people")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}erst:${panel.id}:${entry.id}`).setLabel("Restrictions").setEmoji(appEmojiComponent("people")).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}etgl:${panel.id}:${entry.id}`)
        .setLabel(entry.enabled ? "Désactiver" : "Activer")
        .setStyle(entry.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}eback:${panel.id}`).setLabel("Retour").setEmoji(appEmojiComponent("file")).setStyle(ButtonStyle.Secondary)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}edel:${panel.id}:${entry.id}`)
        .setLabel("Supprimer l'entrée")
        .setEmoji(appEmojiComponent("cancel"))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}esc:${panel.id}:${entry.id}`).setLabel(`Style : ${entry.style}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}ebg:${panel.id}:${entry.id}`).setLabel("Vider les rôles").setStyle(ButtonStyle.Secondary)
    )
  )
  return [container]
}

function buildDeleteContainers(_client: Client, _engine: ReactionRolesEngine, panel: RolePanel): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) =>
    t.setContent(
      appEmojiHeading("cancel", "Supprimer le panel") +
        `\n> *Le panel **${clip(panel.name || panel.id, 40)}** (${panel.entries.length} entrées) et toutes ses attributions seront effacés.*\n> *Confirmez :*`
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}dely:${panel.id}`).setLabel("Oui, supprimer").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}edit:${panel.id}`).setLabel("Annuler").setEmoji(appEmojiComponent("file")).setStyle(ButtonStyle.Secondary)
    )
  )
  return [container]
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

type ViewInteraction = MessageComponentInteraction | ModalSubmitInteraction

function isHubContext(interaction: ViewInteraction): boolean {
  if (interaction.isModalSubmit()) return interaction.isFromMessage() && messageHasConfigHubMarker(interaction.message)
  return messageHasConfigHubMarker(interaction.message)
}

async function renderAndUpdate(interaction: ViewInteraction, containers: ContainerBuilder[]): Promise<void> {
  const components = isHubContext(interaction) ? appendBackButton(containers, CFG_BACK) : containers
  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return
    await interaction.update(configUpdatePayload(components)).catch(() => undefined)
    return
  }
  await interaction.update(configUpdatePayload(components)).catch(() => undefined)
}

async function replyError(interaction: ViewInteraction, text: string): Promise<void> {
  await interaction.reply({ content: text, flags: MessageFlags.Ephemeral }).catch(() => undefined)
}

async function withPanel(engine: ReactionRolesEngine, guildId: string, panelId: string): Promise<RolePanel | null> {
  return engine.getPanel(guildId, panelId)
}

async function withEntry(panel: RolePanel, entryId: string): Promise<RolePanelEntry | null> {
  return panel.entries.find((entry) => entry.id === entryId) ?? null
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function textRow(customId: string, label: string, value: string, style: TextInputStyle = TextInputStyle.Short, maxLength = 4000, required = true): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label.slice(0, 45))
      .setStyle(style)
      .setValue(value.slice(0, maxLength))
      .setMaxLength(maxLength)
      .setRequired(required)
  )
}

function buildNewModal(): ModalBuilder {
  return new ModalBuilder().setCustomId(MODAL_NEW).setTitle("Nouveau panel").addComponents(
    textRow("name", "Nom du panel", "", TextInputStyle.Short, PANEL_LIMITS.MAX_PANEL_NAME)
  )
}

function buildNameModal(panel: RolePanel): ModalBuilder {
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}name:${panel.id}`).setTitle("Nom du panel").addComponents(
    textRow("name", "Nom du panel", panel.name, TextInputStyle.Short, PANEL_LIMITS.MAX_PANEL_NAME)
  )
}

function buildEmbed1Modal(panel: RolePanel): ModalBuilder {
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}emb1:${panel.id}`).setTitle("Embed du panel").addComponents(
    textRow("title", "Titre", panel.embed.title, TextInputStyle.Short, PANEL_LIMITS.MAX_EMBED_TITLE, false),
    textRow("description", "Description", panel.embed.description, TextInputStyle.Paragraph, PANEL_LIMITS.MAX_EMBED_DESCRIPTION, false),
    textRow("color", "Couleur (hex #rrggbb)", panel.embed.color, TextInputStyle.Short, 7, false),
    textRow("image", "Image (URL)", panel.embed.image ?? "", TextInputStyle.Short, PANEL_LIMITS.MAX_EMBED_URL, false),
    textRow("footer", "Pied de page", panel.embed.footer ?? "", TextInputStyle.Short, PANEL_LIMITS.MAX_EMBED_FOOTER, false)
  )
}

function buildEmbed2Modal(panel: RolePanel): ModalBuilder {
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}emb2:${panel.id}`).setTitle("Author / Champs / Miniature").addComponents(
    textRow("author", "Auteur", panel.embed.author ?? "", TextInputStyle.Short, PANEL_LIMITS.MAX_EMBED_AUTHOR, false),
    textRow("thumbnail", "Miniature (URL)", panel.embed.thumbnail ?? "", TextInputStyle.Short, PANEL_LIMITS.MAX_EMBED_URL, false),
    textRow("fields", "Champs (JSON [{name,value,inline}])", JSON.stringify(panel.embed.fields), TextInputStyle.Paragraph, 2500, false)
  )
}

function buildResponsesModal(panel: RolePanel, group: "A" | "B" | "C"): ModalBuilder {
  const fields: { key: keyof RolePanel["responses"]; label: string }[] =
    group === "A"
      ? [
          { key: "granted", label: "Rôle accordé" },
          { key: "removed", label: "Rôle retiré" },
          { key: "denied", label: "Refusé" },
          { key: "cooldown", label: "Cooldown" },
          { key: "limit", label: "Limite" },
        ]
      : group === "B"
        ? [
            { key: "error", label: "Erreur" },
            { key: "dmGranted", label: "DM accordé" },
            { key: "dmRemoved", label: "DM retiré" },
            { key: "logGrant", label: "Log ajout" },
            { key: "logRemove", label: "Log retrait" },
          ]
        : [{ key: "logDeny", label: "Log refus" }]
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}res${group === "A" ? 1 : group === "B" ? 2 : 3}:${panel.id}`)
    .setTitle(`Textes (${group})`)
    .addComponents(
      ...fields.map((field) => textRow(`f_${field.key}`, `${field.label} — {role} {emoji} {user} {server} {panel} {reason}`, panel.responses[field.key], TextInputStyle.Short, PANEL_LIMITS.MAX_RESPONSE_TEXT, false))
    )
}

function buildLimitsModal(panel: RolePanel): ModalBuilder {
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}lim:${panel.id}`).setTitle("Limites du panel").addComponents(
    textRow("maxroles", "Limite de rôles (0 = aucune)", String(panel.maxRoles ?? 0), TextInputStyle.Short, 2),
    textRow("cooldown", "Cooldown en secondes (0 = aucune)", String(panel.cooldownMs ? Math.round(panel.cooldownMs / 1000) : 0), TextInputStyle.Short, 6)
  )
}

function buildEntryContentModal(panel: RolePanel, entry: RolePanelEntry): ModalBuilder {
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}ecnt:${panel.id}:${entry.id}`).setTitle("Contenu de l'entrée").addComponents(
    textRow("label", "Libellé", entry.label, TextInputStyle.Short, PANEL_LIMITS.MAX_ENTRY_LABEL, false),
    textRow("emoji", "Emoji (unicode ou <:nom:id>)", entry.emoji ? emojiDisplay(entry.emoji) : "", TextInputStyle.Short, 64, false),
    textRow("style", "Style bouton (1-4)", String(entry.style), TextInputStyle.Short, 1, false),
    textRow("duration", "Durée avant retrait (ex 10m, 2h, none)", entry.durationMs !== null ? `${Math.max(1, Math.floor(entry.durationMs / 1000))}s` : "none", TextInputStyle.Short, 16, false)
  )
}

function buildEntryRolesModal(panel: RolePanel, entry: RolePanelEntry): ModalBuilder {
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}erole:${panel.id}:${entry.id}`).setTitle("Rôles de l'entrée").addComponents(
    textRow("roles", "Rôles attribués (IDs/mentions)", entry.roles.join(", "), TextInputStyle.Paragraph, 500, false),
    textRow("removeRoles", "Rôles retirés (IDs/mentions)", entry.removeRoles.join(", "), TextInputStyle.Paragraph, 500, false)
  )
}

function buildEntryRestrictionsModal(panel: RolePanel, entry: RolePanelEntry): ModalBuilder {
  return new ModalBuilder().setCustomId(`${MODAL_PREFIX}erst:${panel.id}:${entry.id}`).setTitle("Restrictions de l'entrée").addComponents(
    textRow("required", "Rôles requis (IDs/mentions)", entry.requiredRoles.join(", "), TextInputStyle.Paragraph, 500, false),
    textRow("denied", "Rôles interdits (IDs/mentions)", entry.deniedRoles.join(", "), TextInputStyle.Paragraph, 500, false),
    textRow("minAccount", "Âge du compte min (ex 7d, none)", entry.minAccountAgeMs !== null ? `${Math.max(1, Math.floor(entry.minAccountAgeMs / 1000))}s` : "none", TextInputStyle.Short, 16, false),
    textRow("minMember", "Ancienneté min (ex 1h, none)", entry.minMemberAgeMs !== null ? `${Math.max(1, Math.floor(entry.minMemberAgeMs / 1000))}s` : "none", TextInputStyle.Short, 16, false)
  )
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseRoleIds(input: string, guild: Guild): { ids: string[]; invalid: string[] } {
  const ids: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const token of input.split(/[\s,]+/).filter(Boolean)) {
    const raw = token.replace(/^<@&(\d+)>$/, "$1")
    if (!token.match(/^<@&(\d+)>$/) && !isSnowflake(token)) {
      invalid.push(token)
      continue
    }
    if (!guild.roles.cache.has(raw)) {
      invalid.push(token)
      continue
    }
    if (seen.has(raw)) continue
    seen.add(raw)
    ids.push(raw)
  }
  return { ids, invalid }
}

function parseDurationInput(raw: string): number | null {
  const value = raw.trim().toLowerCase()
  if (!value || value === "none" || value === "0" || value === "off") return null
  const ms = parseTime(value)
  if (ms === null) return null
  return Math.min(ms, PANEL_LIMITS.MAX_DURATION_MS)
}

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------

export async function handleReactionRolesInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith(PREFIX) && !customId.startsWith(MODAL_PREFIX)) return false
  if (!interaction.inGuild() || !interaction.guild) return false
  if (!(await requireAdministrator(interaction))) return true

  const engine = client.reactionroles
  const guild = interaction.guild
  const panelIdOf = (prefix: string): string => customId.slice(prefix.length)
  const entryPart = (prefix: string): [string, string | null] => {
    const rest = customId.slice(prefix.length)
    const [panelId, entryId] = rest.split(":")
    return [panelId, entryId ?? null]
  }

  // ------------------------- Accueil / création ---------------------------
  if (interaction.isButton() && customId === `${PREFIX}home`) {
    await renderAndUpdate(interaction, await buildReactionRolesHome(client, guild))
    return true
  }
  if (interaction.isButton() && customId === `${PREFIX}new`) {
    await interaction.showModal(buildNewModal())
    return true
  }
  if (interaction.isStringSelectMenu() && customId === `${PREFIX}open`) {
    const panel = await withPanel(engine, guild.id, interaction.values[0])
    if (panel) await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  // ------------------------- Retour éditeur (cancel delete) --------------
  if (interaction.isButton() && customId.startsWith(`${PREFIX}edit:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}edit:`))
    if (panel) await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  // ------------------------- Actions panel --------------------------------
  if (interaction.isButton() && customId.startsWith(`${PREFIX}pub:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}pub:`))
    if (!panel) return true
    const result = await publishPanel(client, engine, panel)
    if (!result.ok) {
      await replyError(interaction, result.error ?? "> *Erreur.*")
      return true
    }
    const refreshed = await withPanel(engine, guild.id, panel.id)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, refreshed ?? panel))
    return true
  }

  if (interaction.isButton() && customId.startsWith(`${PREFIX}rep:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}rep:`))
    if (!panel) return true
    await publishPanel(client, engine, panel)
    const refreshed = await withPanel(engine, guild.id, panel.id)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, refreshed ?? panel))
    return true
  }

  if (interaction.isButton() && customId.startsWith(`${PREFIX}tgl:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}tgl:`))
    if (!panel) return true
    panel.enabled = !panel.enabled
    await engine.savePanel(panel)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isButton() && customId.startsWith(`${PREFIX}dm:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}dm:`))
    if (!panel) return true
    panel.dmNotify = !panel.dmNotify
    await engine.savePanel(panel)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isButton() && customId.startsWith(`${PREFIX}dgr:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}dgr:`))
    if (!panel) return true
    panel.allowDangerousRoles = !panel.allowDangerousRoles
    await engine.savePanel(panel)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isButton() && customId.startsWith(`${PREFIX}clear:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}clear:`))
    if (!panel) return true
    panel.logChannelId = null
    await engine.savePanel(panel)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isButton() && customId.startsWith(`${PREFIX}del:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}del:`))
    if (panel) await renderAndUpdate(interaction, buildDeleteContainers(client, engine, panel))
    return true
  }

  if (interaction.isButton() && customId.startsWith(`${PREFIX}dely:`)) {
    const panelId = customId.slice(`${PREFIX}dely:`.length)
    const panel = await withPanel(engine, guild.id, panelId)
    if (panel) {
      if (panel.channelId !== null && panel.messageId !== null) {
        const channel = await client.channels.fetch(panel.channelId).catch(() => null)
        if (channel && channel.isTextBased()) {
          await channel.messages.fetch(panel.messageId).then((message) => message.delete()).catch(() => undefined)
        }
      }
      await engine.deletePanel(guild.id, panelId)
    }
    await renderAndUpdate(interaction, await buildReactionRolesHome(client, guild))
    return true
  }

  if (interaction.isChannelSelectMenu() && customId.startsWith(`${PREFIX}chan:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}chan:`))
    if (!panel) return true
    panel.channelId = interaction.values[0] ?? null
    await engine.savePanel(panel)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isChannelSelectMenu() && customId.startsWith(`${PREFIX}logs:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}logs:`))
    if (!panel) return true
    panel.logChannelId = interaction.values[0] ?? null
    await engine.savePanel(panel)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isStringSelectMenu() && customId.startsWith(`${PREFIX}mode:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}mode:`))
    if (!panel) return true
    const value = interaction.values[0]
    if (isPanelMode(value)) panel.mode = value
    await engine.savePanel(panel)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isStringSelectMenu() && customId.startsWith(`${PREFIX}lang:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}lang:`))
    if (!panel) return true
    const value = interaction.values[0]
    if (isPanelLanguage(value)) panel.language = value
    await engine.savePanel(panel)
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isStringSelectMenu() && customId.startsWith(`${PREFIX}tpl:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}tpl:`))
    if (!panel) return true
    const value = interaction.values[0]
    if (value) {
      applyTemplate(panel, value)
      await engine.savePanel(panel)
    }
    await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  if (interaction.isStringSelectMenu() && customId.startsWith(`${PREFIX}entr:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}entr:`))
    if (!panel) return true
    const entry = await withEntry(panel, interaction.values[0])
    if (entry) await renderAndUpdate(interaction, buildEntryContainers(client, engine, panel, entry))
    return true
  }

  // ------------------------- Modals panel --------------------------------
  const panelModalOpeners: Record<string, (panel: RolePanel) => ModalBuilder> = {
    name: buildNameModal,
    emb1: buildEmbed1Modal,
    emb2: buildEmbed2Modal,
    res1: (panel) => buildResponsesModal(panel, "A"),
    res2: (panel) => buildResponsesModal(panel, "B"),
    res3: (panel) => buildResponsesModal(panel, "C"),
    lim: buildLimitsModal,
  }
  for (const [key, builder] of Object.entries(panelModalOpeners)) {
    const prefix = `${PREFIX}${key}:`
    if (interaction.isButton() && customId.startsWith(prefix)) {
      const panel = await withPanel(engine, guild.id, panelIdOf(prefix))
      if (panel) await interaction.showModal(builder(panel))
      return true
    }
  }

  // ------------------------- Entrées ---------------------------------------
  for (const action of ["addr", "addb", "adds"] as const) {
    if (interaction.isButton() && customId.startsWith(`${PREFIX}${action}:`)) {
      const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}${action}:`))
      if (!panel) return true
      if (panel.entries.length >= PANEL_LIMITS.MAX_ENTRIES) {
        await replyError(interaction, `> *Maximum ${PANEL_LIMITS.MAX_ENTRIES} entrées par panel.*`)
        return true
      }
      const seed = action === "addb" ? { label: "Rôle" } : action === "adds" ? { label: "Choisir un rôle" } : undefined
      const entry = defaultEntry(action === "addr" ? "reaction" : action === "addb" ? "button" : "select", seed)
      panel.entries.push(entry)
      await engine.savePanel(panel)
      await renderAndUpdate(interaction, buildEntryContainers(client, engine, panel, entry))
      return true
    }
  }

  if (interaction.isButton() && customId.startsWith(`${PREFIX}eback:`)) {
    const panel = await withPanel(engine, guild.id, panelIdOf(`${PREFIX}eback:`))
    if (panel) await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
    return true
  }

  for (const action of ["ecnt", "erole", "erst"] as const) {
    const prefix = `${PREFIX}${action}:`
    if (interaction.isButton() && customId.startsWith(prefix)) {
      const [panelId, entryId] = entryPart(prefix)
      const panel = await withPanel(engine, guild.id, panelId)
      const entry = panel ? await withEntry(panel, entryId ?? "") : null
      if (panel && entry) {
        const modal = action === "ecnt" ? buildEntryContentModal(panel, entry) : action === "erole" ? buildEntryRolesModal(panel, entry) : buildEntryRestrictionsModal(panel, entry)
        await interaction.showModal(modal)
      }
      return true
    }
  }

  for (const action of ["etgl", "esc", "ebg", "edel"] as const) {
    const prefix = `${PREFIX}${action}:`
    if (interaction.isButton() && customId.startsWith(prefix)) {
      const [panelId, entryId] = entryPart(prefix)
      const panel = await withPanel(engine, guild.id, panelId)
      const entry = panel ? await withEntry(panel, entryId ?? "") : null
      if (panel && entry) {
        if (action === "etgl") entry.enabled = !entry.enabled
        else if (action === "esc") entry.style = (entry.style % 4) + 1
        else if (action === "ebg") {
          entry.roles = []
          entry.removeRoles = []
        } else {
          const index = panel.entries.findIndex((item) => item.id === entry.id)
          if (index >= 0) panel.entries.splice(index, 1)
          await engine.store().deleteGrantsForEntry(guild.id, panel.id, entry.id).catch(() => undefined)
        }
        await engine.savePanel(panel)
        const refreshed = await withPanel(engine, guild.id, panel.id)
        if (refreshed) {
          const updated = await withEntry(refreshed, entry.id)
          if (updated) await renderAndUpdate(interaction, buildEntryContainers(client, engine, refreshed, updated))
          else await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, refreshed))
        }
      }
      return true
    }
  }

  // ------------------------- Soumission modals ------------------------------
  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false
    const fields = (key: string): string => interaction.fields.getTextInputValue(key).trim()

    if (customId === MODAL_NEW) {
      const panel = defaultPanel(guild.id)
      panel.name = clip(fields("name") || "Panel", PANEL_LIMITS.MAX_PANEL_NAME)
      await engine.savePanel(panel)
      await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
      return true
    }

    if (customId.startsWith(`${MODAL_PREFIX}name:`)) {
      const panel = await withPanel(engine, guild.id, panelIdOf(`${MODAL_PREFIX}name:`))
      if (panel) {
        panel.name = clip(fields("name") || panel.name, PANEL_LIMITS.MAX_PANEL_NAME)
        await engine.savePanel(panel)
        await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
      }
      return true
    }

    if (customId.startsWith(`${MODAL_PREFIX}emb1:`)) {
      const panel = await withPanel(engine, guild.id, panelIdOf(`${MODAL_PREFIX}emb1:`))
      if (panel) {
        panel.embed.title = fields("title")
        panel.embed.description = fields("description")
        if (/^#?[0-9a-fA-F]{6}$/.test(fields("color"))) panel.embed.color = fields("color")
        panel.embed.image = fields("image") || null
        panel.embed.footer = fields("footer") || null
        await engine.savePanel(panel)
        await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
      }
      return true
    }

    if (customId.startsWith(`${MODAL_PREFIX}emb2:`)) {
      const panel = await withPanel(engine, guild.id, panelIdOf(`${MODAL_PREFIX}emb2:`))
      if (panel) {
        panel.embed.author = fields("author") || null
        panel.embed.thumbnail = fields("thumbnail") || null
        const rawFields = fields("fields")
        if (rawFields) {
          try {
            const parsed = JSON.parse(rawFields) as unknown
            if (Array.isArray(parsed)) {
              panel.embed.fields = parsed
                .slice(0, PANEL_LIMITS.MAX_EMBED_FIELDS)
                .map((item) => {
                  const record = (item ?? {}) as Record<string, unknown>
                  return {
                    name: clip(String(record.name ?? ""), PANEL_LIMITS.MAX_FIELD_NAME),
                    value: clip(String(record.value ?? ""), PANEL_LIMITS.MAX_FIELD_VALUE),
                    inline: record.inline === true,
                  }
                })
                .filter((field) => field.name || field.value)
            }
          } catch {
            await replyError(interaction, "> *Champs JSON invalide. Exemple : `[{\"name\":\"Titre\",\"value\":\"Texte\",\"inline\":true}]`.*")
            return true
          }
        }
        await engine.savePanel(panel)
        await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
      }
      return true
    }

    for (const [groupKey, group] of [["res1", "A"], ["res2", "B"], ["res3", "C"]] as const) {
      if (customId.startsWith(`${MODAL_PREFIX}${groupKey}:`)) {
        const panel = await withPanel(engine, guild.id, panelIdOf(`${MODAL_PREFIX}${groupKey}:`))
        if (panel) {
          const keys: (keyof RolePanel["responses"])[] =
            group === "A" ? ["granted", "removed", "denied", "cooldown", "limit"] : group === "B" ? ["error", "dmGranted", "dmRemoved", "logGrant", "logRemove"] : ["logDeny"]
          for (const key of keys) {
            const value = fields(`f_${key}`)
            if (value) panel.responses[key] = clip(value, PANEL_LIMITS.MAX_RESPONSE_TEXT)
          }
          await engine.savePanel(panel)
          await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
        }
        return true
      }
    }

    if (customId.startsWith(`${MODAL_PREFIX}lim:`)) {
      const panel = await withPanel(engine, guild.id, panelIdOf(`${MODAL_PREFIX}lim:`))
      if (panel) {
        const rawMax = Number(fields("maxroles"))
        panel.maxRoles = Number.isInteger(rawMax) && rawMax > 0 ? Math.min(rawMax, PANEL_LIMITS.MAX_MAX_ROLES) : null
        const rawCooldown = Number(fields("cooldown"))
        panel.cooldownMs = Number.isFinite(rawCooldown) && rawCooldown > 0 ? Math.min(Math.round(rawCooldown * 1000), PANEL_LIMITS.MAX_COOLDOWN_MS) : null
        await engine.savePanel(panel)
        await renderAndUpdate(interaction, await buildEditorContainers(client, engine, guild, panel))
      }
      return true
    }

    for (const [prefix, action] of [["ecnt", "ecnt"], ["erole", "erole"], ["erst", "erst"]] as const) {
      if (customId.startsWith(`${MODAL_PREFIX}${prefix}:`)) {
        const [panelId, entryId] = entryPart(`${MODAL_PREFIX}${prefix}:`)
        const panel = await withPanel(engine, guild.id, panelId)
        const entry = panel ? await withEntry(panel, entryId ?? "") : null
        if (panel && entry) {
          if (action === "ecnt") {
            entry.label = clip(fields("label"), PANEL_LIMITS.MAX_ENTRY_LABEL)
            entry.emoji = parseEmojiToken(fields("emoji") || null)
            const style = Number(fields("style"))
            entry.style = Number.isInteger(style) && style >= 1 && style <= 4 ? style : entry.style
            entry.durationMs = parseDurationInput(fields("duration"))
          } else if (action === "erole") {
            const roles = parseRoleIds(fields("roles"), guild)
            const removed = parseRoleIds(fields("removeRoles"), guild)
            const invalid = [...roles.invalid, ...removed.invalid]
            if (invalid.length > 0) {
              await replyError(interaction, `> *Rôles invalides : \`${invalid.join("`, `")}\`.*`)
              return true
            }
            entry.roles = roles.ids.slice(0, PANEL_LIMITS.MAX_ROLES_PER_ENTRY)
            entry.removeRoles = removed.ids.slice(0, PANEL_LIMITS.MAX_ROLES_PER_ENTRY)
          } else {
            const required = parseRoleIds(fields("required"), guild)
            const denied = parseRoleIds(fields("denied"), guild)
            const invalid = [...required.invalid, ...denied.invalid]
            if (invalid.length > 0) {
              await replyError(interaction, `> *Rôles invalides : \`${invalid.join("`, `")}\`.*`)
              return true
            }
            entry.requiredRoles = required.ids.slice(0, PANEL_LIMITS.MAX_RESTRICT_ROLES)
            entry.deniedRoles = denied.ids.slice(0, PANEL_LIMITS.MAX_RESTRICT_ROLES)
            entry.minAccountAgeMs = parseDurationInput(fields("minAccount"))
            entry.minMemberAgeMs = parseDurationInput(fields("minMember"))
          }
          await engine.savePanel(panel)
          const refreshed = await withPanel(engine, guild.id, panel.id)
          if (refreshed) {
            const updated = await withEntry(refreshed, entry.id)
            if (updated) await renderAndUpdate(interaction, buildEntryContainers(client, engine, refreshed, updated))
          }
        }
        return true
      }
    }

    return false
  }

  return false
}