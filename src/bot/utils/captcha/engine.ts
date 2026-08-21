import { randomInt } from "node:crypto"
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type GuildTextBasedChannel,
  type Interaction,
  type Message,
  type PartialGuildMember,
} from "discord.js"
import { getConfig, type CaptchaConfig } from "./schema.js"
import { appEmojiOrFallback, appEmojiText } from "../appEmojis.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e
const SWEEP_INTERVAL = 15_000
const CODE_LENGTH = 5
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export interface PendingChallenge {
  guildId: string
  userId: string
  code: string
  attempts: number
  createdAt: number
  expiresAt: number
  channelId: string
  messageId: string
  timeout: number
  maxAttempts: number
  kickOnFail: boolean
  roleId: string
}

const pending = new Map<string, PendingChallenge>()
let clientRef: Client | null = null
let sweepStarted = false

function sessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`
}

function ensureSweep(client: Client): void {
  clientRef = client
  if (sweepStarted) return
  sweepStarted = true
  setInterval(() => {
    void sweepExpired()
  }, SWEEP_INTERVAL).unref()
}

export function generateCode(): string {
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return code
}

function normalizeCode(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase()
}

function buildChallengeComponents(userId: string, code: string): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("check")} 〃 Vérification`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Bienvenue <@${userId}> ! Entrez le code ci-dessous pour accéder au serveur.*\n\n` +
        `> ***Code :** \`${code}\`*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`cp_verify:${userId}`)
        .setLabel("Vérifier")
        .setEmoji(appEmojiOrFallback("check"))
        .setStyle(ButtonStyle.Success)
    )
  )
  return [container]
}

function buildVerifyModal(userId: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("code")
    .setLabel("Code de vérification")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(10)
    .setPlaceholder("Entrez le code affiché")

  return new ModalBuilder()
    .setCustomId(`cp_modal:${userId}`)
    .setTitle("Vérification")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

async function resolveTextChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null
  return channel
}

async function deleteChallengeMessage(session: PendingChallenge): Promise<void> {
  const client = clientRef
  if (!client) return
  const channel = await resolveTextChannel(client, session.channelId)
  if (!channel) return
  await channel.messages.delete(session.messageId).catch(() => undefined)
}

async function failChallenge(session: PendingChallenge, reason: "timeout" | "attempts"): Promise<void> {
  pending.delete(sessionKey(session.guildId, session.userId))
  await deleteChallengeMessage(session)

  if (!session.kickOnFail) return
  const client = clientRef
  if (!client) return
  const guild = client.guilds.cache.get(session.guildId) ?? (await client.guilds.fetch(session.guildId).catch(() => null))
  if (!guild) return
  const member = await guild.members.fetch(session.userId).catch(() => null)
  if (!member || !member.kickable) return
  const kickReason = reason === "timeout" ? "Captcha — temps écoulé" : "Captcha — trop de tentatives"
  await member.kick(kickReason).catch((error) => {
    console.error(`Failed to kick ${session.userId} after captcha ${reason} in guild ${session.guildId}:`, error)
  })
}

async function sweepExpired(): Promise<void> {
  const now = Date.now()
  const expired: PendingChallenge[] = []
  for (const session of pending.values()) {
    if (session.expiresAt <= now) expired.push(session)
  }
  for (const session of expired) {
    await failChallenge(session, "timeout")
  }
}

function sessionFromConfig(
  member: GuildMember,
  config: CaptchaConfig,
  code: string,
  channelId: string,
  messageId: string
): PendingChallenge {
  const now = Date.now()
  return {
    guildId: member.guild.id,
    userId: member.id,
    code,
    attempts: 0,
    createdAt: now,
    expiresAt: now + config.timeout,
    channelId,
    messageId,
    timeout: config.timeout,
    maxAttempts: config.maxAttempts,
    kickOnFail: config.kickOnFail,
    roleId: config.roleId as string,
  }
}

export async function startChallenge(client: Client, member: GuildMember): Promise<void> {
  ensureSweep(client)

  let config: CaptchaConfig
  try {
    config = await getConfig(member.guild.id)
  } catch (error) {
    console.error(`Failed to load captcha config for guild ${member.guild.id}:`, error)
    return
  }

  if (!config.enabled) return
  if (config.ignoreBots && member.user.bot) return
  if (!config.channelId || !config.roleId) return
  if (member.roles.cache.has(config.roleId)) return

  const existing = pending.get(sessionKey(member.guild.id, member.id))
  if (existing) {
    pending.delete(sessionKey(member.guild.id, member.id))
    await deleteChallengeMessage(existing)
  }

  const channel = await resolveTextChannel(client, config.channelId)
  if (!channel) {
    console.error(`Captcha channel ${config.channelId} is missing or not text-based in guild ${member.guild.id}`)
    return
  }

  const code = generateCode()
  const sent = await channel
    .send({
      components: buildChallengeComponents(member.id, code),
      flags: COMPONENTS_V2_FLAGS,
      allowedMentions: { parse: [], users: [member.id] },
    })
    .catch((error: unknown) => {
      console.error(`Failed to send captcha challenge in guild ${member.guild.id}:`, error)
      return null
    })
  if (!sent) return

  pending.set(sessionKey(member.guild.id, member.id), sessionFromConfig(member, config, code, config.channelId, sent.id))
}

export async function dropSession(guildId: string, userId: string): Promise<void> {
  const key = sessionKey(guildId, userId)
  const session = pending.get(key)
  if (!session) return
  pending.delete(key)
  await deleteChallengeMessage(session)
}

async function recreateSession(interaction: ButtonInteraction, userId: string): Promise<PendingChallenge | null> {
  const guild = interaction.guild
  if (!guild) return null
  const config = await getConfig(guild.id)
  if (!config.enabled || !config.roleId) return null
  const code = generateCode()
  const now = Date.now()
  const message = interaction.message as Message
  const session: PendingChallenge = {
    guildId: guild.id,
    userId,
    code,
    attempts: 0,
    createdAt: now,
    expiresAt: now + config.timeout,
    channelId: message.channelId,
    messageId: message.id,
    timeout: config.timeout,
    maxAttempts: config.maxAttempts,
    kickOnFail: config.kickOnFail,
    roleId: config.roleId,
  }
  await message
    .edit({
      components: buildChallengeComponents(userId, code),
      flags: COMPONENTS_V2_FLAGS,
    })
    .catch(() => undefined)
  pending.set(sessionKey(session.guildId, userId), session)
  return session
}

async function grantRole(member: GuildMember, roleId: string): Promise<boolean> {
  if (member.roles.cache.has(roleId)) return true

  const role = member.guild.roles.cache.get(roleId) ?? (await member.guild.roles.fetch(roleId).catch(() => null))
  if (!role || role.id === member.guild.id) return false

  await member.guild.members.fetchMe().catch(() => null)

  try {
    await member.roles.add(role, "Captcha — vérifié")
    return true
  } catch (error) {
    console.error(`Failed to add captcha role ${roleId} in guild ${member.guild.id}:`, error)
    return false
  }
}

export async function handleChallengeInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guild) return false
  const customId = interaction.isMessageComponent() || interaction.isModalSubmit() ? interaction.customId : ""
  if (!customId.startsWith("cp_verify:") && !customId.startsWith("cp_modal:")) return false

  ensureSweep(client)

  const userId = customId.startsWith("cp_verify:") ? customId.slice("cp_verify:".length) : customId.slice("cp_modal:".length)
  if (!userId) return false

  if (interaction.user.id !== userId) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: "> *Ce défi n'est pas pour vous.*",
        flags: MessageFlags.Ephemeral,
      })
    }
    return true
  }

  if (interaction.isButton() && customId.startsWith("cp_verify:")) {
    let session: PendingChallenge | null | undefined = pending.get(sessionKey(interaction.guild.id, userId))
    if (session && session.expiresAt <= Date.now()) {
      await failChallenge(session, "timeout")
      await interaction.reply({
        content: "> *Ce défi a expiré.*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    if (!session) {
      session = await recreateSession(interaction, userId)
      if (!session) {
        await interaction.reply({
          content: "> *La vérification n'est plus disponible.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
    }
    await interaction.showModal(buildVerifyModal(userId))
    return true
  }

  if (!interaction.isModalSubmit() || !customId.startsWith("cp_modal:")) return false

  const session = pending.get(sessionKey(interaction.guild.id, userId))
  if (!session || session.expiresAt <= Date.now()) {
    if (session) await failChallenge(session, "timeout")
    await interaction.reply({
      content: "> *Ce défi a expiré. Un nouveau code a été demandé, cliquez à nouveau sur **Vérifier**.*",
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  const submitted = normalizeCode(interaction.fields.getTextInputValue("code"))
  if (submitted === session.code) {
    const member = await interaction.guild.members.fetch(userId).catch(() => null)
    if (!member) {
      pending.delete(sessionKey(session.guildId, userId))
      await interaction.reply({
        content: "> *Membre introuvable.*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const ok = await grantRole(member, session.roleId)
    if (!ok) {
      await interaction.reply({
        content: "> *Impossible d'attribuer le rôle. Vérifiez la hiérarchie et les permissions du bot.*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    pending.delete(sessionKey(session.guildId, userId))
    if (interaction.isFromMessage()) {
      await interaction.deferUpdate().catch(() => undefined)
      await interaction.message.delete().catch(() => undefined)
    } else {
      await interaction.reply({
        content: "> *Vérification réussie.*",
        flags: MessageFlags.Ephemeral,
      })
      await deleteChallengeMessage(session)
    }

    const channel = await resolveTextChannel(client, session.channelId)
    if (channel) {
      await channel
        .send({
          content: `> *<@${userId}> a passé la vérification.*`,
          allowedMentions: { parse: [], users: [] },
        })
        .catch(() => undefined)
    }
    return true
  }

  session.attempts += 1
  const remaining = session.maxAttempts - session.attempts
  if (remaining <= 0) {
    await interaction
      .reply({
        content: "> *Trop de tentatives. Vérification échouée.*",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined)
    await failChallenge(session, "attempts")
    return true
  }

  await interaction.reply({
    content: `> *Code incorrect. Il vous reste **${remaining}** essai${remaining > 1 ? "s" : ""}.*`,
    flags: MessageFlags.Ephemeral,
  })
  return true
}

export async function handleMemberLeave(member: GuildMember | PartialGuildMember): Promise<void> {
  await dropSession(member.guild.id, member.id)
}
