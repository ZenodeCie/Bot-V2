import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  type Client,
  type GuildMember,
  type GuildTextBasedChannel,
  type Interaction,
} from "discord.js"
import { getConfig, updateConfig, type RulesConfig } from "./schema.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e
const TEXT_LIMIT = 4000

const EMOJI_IDS = {
  check: "1469692151251341425",
} as const

const EMOJI_TAGS = {
  notes: "<:Notes:1469692988870623369>",
} as const

export type PublishResult = { ok: true; config: RulesConfig } | { ok: false; error: string }

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

async function resolveTextChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null
  return channel
}

function packText(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  if (text.length <= TEXT_LIMIT) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, TEXT_LIMIT))
    remaining = remaining.slice(TEXT_LIMIT)
  }
  return chunks
}

export function buildPublicContainer(config: RulesConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  const title = clip(config.title.trim() || "Règlement", 256)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.notes} 〃 ${title}`))
  container.addSeparatorComponents((s) => s.setSpacing(1))

  const body = config.description.trim()
    ? packText(config.description.trim())
    : ["> *Aucun règlement n'est rédigé. Éditez le texte dans le panneau.*"]
  for (const chunk of body) {
    container.addTextDisplayComponents((t) => t.setContent(chunk))
  }

  if (config.roleId) {
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addTextDisplayComponents((t) =>
      t.setContent("> *Cliquez sur **J'accepte** pour confirmer que vous avez lu le règlement.*")
    )
    container.addActionRowComponents((row) =>
      row.setComponents(
        new ButtonBuilder()
          .setCustomId("rl_accept")
          .setLabel("J'accepte")
          .setEmoji({ id: EMOJI_IDS.check })
          .setStyle(ButtonStyle.Success)
      )
    )
  }

  return [container]
}

export async function publishRules(client: Client, guildId: string): Promise<PublishResult> {
  const config = await getConfig(guildId)
  if (!config.channelId) {
    return { ok: false, error: "> *Configurez encore un **salon**.*" }
  }

  const channel = await resolveTextChannel(client, config.channelId)
  if (!channel) {
    return { ok: false, error: "> *Impossible d'accéder au salon. Vérifiez les permissions du bot.*" }
  }

  const components = buildPublicContainer(config)
  let messageId = config.messageId

  if (messageId) {
    const existing = await channel.messages.fetch(messageId).catch(() => null)
    if (existing) {
      const edited = await existing
        .edit({
          components,
          flags: COMPONENTS_V2_FLAGS,
          allowedMentions: { parse: [] },
        })
        .catch((error: unknown) => {
          console.error(`Failed to edit rules in guild ${guildId}:`, error)
          return null
        })
      if (!edited) {
        return { ok: false, error: "> *Impossible de mettre à jour le règlement. Vérifiez les permissions du bot.*" }
      }
    } else {
      messageId = null
    }
  }

  if (!messageId) {
    const sent = await channel
      .send({
        components,
        flags: COMPONENTS_V2_FLAGS,
        allowedMentions: { parse: [] },
      })
      .catch((error: unknown) => {
        console.error(`Failed to send rules in guild ${guildId}:`, error)
        return null
      })
    if (!sent) {
      return { ok: false, error: "> *Impossible d'envoyer le règlement dans ce salon. Vérifiez les permissions du bot.*" }
    }
    messageId = sent.id
  }

  const updated = await updateConfig(guildId, { $set: { messageId } })
  return { ok: true, config: updated }
}

export async function republishIfPublished(client: Client, guildId: string): Promise<void> {
  const config = await getConfig(guildId)
  if (!config.enabled || !config.channelId) return
  await publishRules(client, guildId)
}

async function grantRole(member: GuildMember, roleId: string): Promise<boolean> {
  if (member.roles.cache.has(roleId)) return true

  const role = member.guild.roles.cache.get(roleId) ?? (await member.guild.roles.fetch(roleId).catch(() => null))
  if (!role || role.id === member.guild.id) return false

  await member.guild.members.fetchMe().catch(() => null)

  try {
    await member.roles.add(role, "Règlement — accepté")
    return true
  } catch (error) {
    console.error(`Failed to add rules role ${roleId} in guild ${member.guild.id}:`, error)
    return false
  }
}

export async function handleAcceptInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || interaction.customId !== "rl_accept") return false
  if (!interaction.inGuild() || !interaction.guild) return false

  const config = await getConfig(interaction.guild.id)
  if (!config.enabled) {
    await interaction.reply({
      content: "> *Le règlement n'est pas activé sur ce serveur.*",
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (config.ignoreBots && interaction.user.bot) {
    await interaction.reply({
      content: "> *Les bots ne peuvent pas valider le règlement.*",
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (!config.roleId) {
    await interaction.reply({
      content: "> *Aucun rôle de validation n'est configuré.*",
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  const member =
    interaction.guild.members.cache.get(interaction.user.id) ??
    (await interaction.guild.members.fetch(interaction.user.id).catch(() => null))
  if (!member) {
    await interaction.reply({
      content: "> *Impossible de récupérer votre membre sur ce serveur.*",
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  if (member.roles.cache.has(config.roleId)) {
    await interaction.reply({
      content: "> *Vous avez déjà accepté le règlement.*",
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  const granted = await grantRole(member, config.roleId)
  if (!granted) {
    await interaction.reply({
      content: "> *Impossible de vous attribuer le rôle. Prévenez un administrateur.*",
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  await interaction.reply({
    content: "> *Vous avez accepté le règlement.*",
    flags: MessageFlags.Ephemeral,
  })
  return true
}
