import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  type MessageActionRowComponentBuilder,
} from "discord.js"
import { emojiDisplay, type RolePanel, type RolePanelEntry } from "./schema.js"
import { joinRoleNames } from "./messages.js"
import type { ReactionRolesEngine } from "./engine.js"

/**
 * Rendu et publication d'un panel : embed configurable + boutons / selects,
 * réactions ajoutées au message, resynchronisation des réactions à l'édition.
 */

const MAX_COMPONENT_ROWS = 5
const MAX_SELECT_OPTIONS = 25
const MAX_BUTTONS_PER_ROW = 5

export interface PublishResult {
  ok: boolean
  message?: Message
  error?: string
}

function clip(value: string, max: number): string {
  const text = value.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function parseHexColor(hex: string): number {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return 0x5865f2
  return Number.parseInt(match[1], 16)
}

export function buildPanelEmbed(panel: RolePanel): EmbedBuilder {
  const embed = new EmbedBuilder()
  embed.setColor(parseHexColor(panel.embed.color))
  if (panel.embed.title) embed.setTitle(clip(panel.embed.title, 256))
  if (panel.embed.description) embed.setDescription(clip(panel.embed.description, 4096))
  if (panel.embed.thumbnail) embed.setThumbnail(panel.embed.thumbnail)
  if (panel.embed.image) embed.setImage(panel.embed.image)
  if (panel.embed.author) embed.setAuthor({ name: clip(panel.embed.author, 256) })
  if (panel.embed.footer) embed.setFooter({ text: clip(panel.embed.footer, 2048) })
  for (const field of panel.embed.fields) {
    embed.addFields({
      name: clip(field.name, 256) || "\u200b",
      value: clip(field.value, 1024) || "\u200b",
      inline: field.inline,
    })
  }
  return embed
}

function buttonStyleFor(style: number): ButtonStyle {
  if (style === ButtonStyle.Primary || style === ButtonStyle.Secondary || style === ButtonStyle.Success || style === ButtonStyle.Danger) {
    return style
  }
  return ButtonStyle.Secondary
}

function entryEmoji(entry: RolePanelEntry): { name: string; id?: string; animated?: boolean } | null {
  if (!entry.emoji) return null
  if (entry.emoji.id) return { name: entry.emoji.name || "e", id: entry.emoji.id, animated: entry.emoji.animated }
  if (!entry.emoji.name) return null
  return { name: entry.emoji.name }
}

function roleNamesFor(guild: Guild, entry: RolePanelEntry, language: RolePanel["language"]): string {
  const names: string[] = []
  for (const roleId of entry.roles) {
    const role = guild.roles.cache.get(roleId)
    names.push(role ? role.name : `<@&${roleId}>`)
  }
  return joinRoleNames(names, language)
}

export function buildPanelComponents(panel: RolePanel, guild: Guild): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = []
  const buttons = panel.entries.filter((entry) => entry.enabled && entry.entryType === "button")
  const selects = panel.entries.filter((entry) => entry.enabled && entry.entryType === "select")

  const buttonRowCount = Math.min(Math.ceil(buttons.length / MAX_BUTTONS_PER_ROW), MAX_COMPONENT_ROWS - Math.min(selects.length, MAX_COMPONENT_ROWS))
  const usableButtonRows = Math.max(buttonRowCount, 0)

  let buttonIndex = 0
  for (let rowIdx = 0; rowIdx < usableButtonRows; rowIdx += 1) {
    const slice = buttons.slice(buttonIndex, buttonIndex + MAX_BUTTONS_PER_ROW)
    buttonIndex += slice.length
    if (slice.length === 0) continue
    const row = new ActionRowBuilder<ButtonBuilder>()
    for (const entry of slice) {
      const button = new ButtonBuilder()
        .setCustomId(`rrb:${panel.id}:${entry.id}`)
        .setStyle(buttonStyleFor(entry.style))
      const label = clip(entry.label, 80)
      if (label) button.setLabel(label)
      const emoji = entryEmoji(entry)
      if (emoji) button.setEmoji(emoji)
      if (!label && !emoji) button.setLabel("Rôle")
      row.addComponents(button)
    }
    rows.push(row)
  }

  const selectRowCount = Math.min(selects.length, MAX_COMPONENT_ROWS - rows.length)
  for (let idx = 0; idx < selectRowCount; idx += 1) {
    const slice = selects.slice(idx * MAX_SELECT_OPTIONS, idx * MAX_SELECT_OPTIONS + MAX_SELECT_OPTIONS)
    if (slice.length === 0) continue
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rrs:${panel.id}:${idx}`)
      .setMinValues(0)
      .setMaxValues(Math.max(slice.length, 1))
    const placeholder = selects[idx]?.label ? clip(selects[idx].label, 100) : panel.name || "Sélectionnez vos rôles"
    menu.setPlaceholder(clip(placeholder, 100))
    for (const entry of slice) {
      const option = new StringSelectMenuOptionBuilder().setValue(entry.id)
      const label = clip(entry.label, 100) || "Rôle"
      option.setLabel(label)
      const description = roleNamesFor(guild, entry, panel.language)
      if (description) option.setDescription(clip(description, 100))
      const emoji = entryEmoji(entry)
      if (emoji) option.setEmoji(emoji)
      menu.addOptions(option)
    }
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))
  }

  return rows
}

export function buildPanelPayload(panel: RolePanel, guild: Guild): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
  return {
    embeds: [buildPanelEmbed(panel)],
    components: buildPanelComponents(panel, guild),
  }
}

function reactionToken(entry: RolePanelEntry): string | null {
  const display = emojiDisplay(entry.emoji)
  return display || null
}

/** Ajoute les réactions manquantes et retire celles du bot devenues inutiles. */
export async function syncReactions(message: Message, panel: RolePanel): Promise<void> {
  const needed = new Map<string, string>()
  for (const entry of panel.entries) {
    if (!entry.enabled || entry.entryType !== "reaction") continue
    const token = reactionToken(entry)
    if (token) needed.set(entry.emoji?.id ?? entry.emoji?.name ?? token, token)
  }

  const present = new Map<string, string>()
  for (const reaction of message.reactions.cache.values()) {
    const key = reaction.emoji.id ?? reaction.emoji.name ?? ""
    if (key) present.set(key, reaction.emoji.id ? reaction.emoji.identifier : reaction.emoji.name ?? "")
  }

  for (const [key, token] of needed) {
    if (present.has(key)) continue
    await message.react(token).catch(() => undefined)
  }

  for (const [key] of present) {
    if (needed.has(key)) continue
    const reaction = message.reactions.cache.find((item) => (item.emoji.id ?? item.emoji.name) === key)
    if (!reaction) continue
    await reaction.users.remove(message.client.user?.id ?? "").catch(() => undefined)
  }
}

async function resolveTextChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || channel.isDMBased() || !channel.isTextBased() || !channel.isSendable()) return null
  return channel
}

export async function publishPanel(client: Client, engine: ReactionRolesEngine, panel: RolePanel): Promise<PublishResult> {
  if (!panel.channelId) return { ok: false, error: "> *Configurez encore un **salon** pour publier le panel.*" }
  const channel = await resolveTextChannel(client, panel.channelId)
  if (!channel) {
    return { ok: false, error: "> *Impossible d'accéder au salon. Vérifiez les permissions du bot.*" }
  }
  const guild = channel.guild
  if (!guild) return { ok: false, error: "> *Le salon doit appartenir à un serveur.*" }

  const payload = buildPanelPayload(panel, guild)
  let message: Message | null = null

  if (panel.messageId) {
    message = await channel.messages.fetch(panel.messageId).catch(() => null)
    if (message) {
      const edited = await message
        .edit({ embeds: payload.embeds, components: payload.components, allowedMentions: { parse: [] } })
        .catch((error: unknown) => {
          console.error(`ReactionRoles publish edit failed (guild ${guild.id}, panel ${panel.id}):`, error)
          return null
        })
      if (!edited) return { ok: false, error: "> *Impossible de mettre à jour le message du panel.*" }
      message = edited
    } else {
      panel.messageId = null
    }
  }

  if (!message) {
    const sent = await channel
      .send({ embeds: payload.embeds, components: payload.components, allowedMentions: { parse: [] } })
      .catch((error: unknown) => {
        console.error(`ReactionRoles publish send failed (guild ${guild.id}, panel ${panel.id}):`, error)
        return null
      })
    if (!sent) {
      return { ok: false, error: "> *Impossible d'envoyer le message du panel. Vérifiez les permissions du bot.*" }
    }
    message = sent
  }

  panel.channelId = channel.id
  panel.messageId = message.id
  await engine.savePanel(panel)
  await syncReactions(message, panel)

  return { ok: true, message }
}

/**
 * Resynchronisation au démarrage : vérifie que les messages des panels publiés
 * existent encore, resynchronise leurs réactions et annule messageId si le
 * message ou le salon a disparu (ne casse jamais le démarrage).
 */
export async function syncPublishedPanels(client: Client, engine: ReactionRolesEngine): Promise<number> {
  let touched = 0
  for (const guild of client.guilds.cache.values()) {
    const panels = await engine.getPanels(guild.id)
    for (const panel of panels) {
      if (!panel.messageId || !panel.channelId) continue
      const channel = await client.channels.fetch(panel.channelId).catch(() => null)
      if (!channel || channel.isDMBased() || !channel.isTextBased() || !channel.isSendable() || channel.guild.id !== guild.id) {
        panel.messageId = null
        await engine.savePanel(panel).catch(() => undefined)
        continue
      }
      const message = await channel.messages.fetch(panel.messageId).catch(() => null)
      if (!message) {
        panel.messageId = null
        await engine.savePanel(panel).catch(() => undefined)
        continue
      }
      await syncReactions(message, panel).catch(() => undefined)
      touched += 1
    }
  }
  return touched
}
