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
import formatTime from "../formatTime.js"
import parseTime from "../parseTime.js"
import { handleChallengeInteraction } from "./engine.js"
import { getConfig, updateConfig, type CaptchaConfig } from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e
const MIN_TIMEOUT = 30 * 1000
const MAX_TIMEOUT = 24 * 60 * 60 * 1000
const MIN_ATTEMPTS = 1
const MAX_ATTEMPTS = 10

const EMOJI_IDS = {
  bot: "1469692094342762526",
  channel: "1469692104589705376",
  check: "1469692151251341425",
  cog: "1469692155680526427",
  cogUser: "1469692167122325577",
  disable: "1469692191298556099",
  enable: "1469692252988116992",
  leave: "1469692941068009686",
  notes: "1469692988870623369",
} as const

const emoji = (key: keyof typeof EMOJI_IDS): { id: string } => ({ id: EMOJI_IDS[key] })

const EMOJI_TAGS = {
  bot: "<:Bot:1469692094342762526>",
  channel: "<:Channel:1469692104589705376>",
  check: "<:Check:1469692151251341425>",
  cog: "<:Cog:1469692155680526427>",
  cogUser: "<:CogUser:1469692167122325577>",
  disable: "<:Disable:1469692191298556099>",
  enable: "<:Enable:1469692252988116992>",
  leave: "<:Leave:1469692941068009686>",
  notes: "<:Notes:1469692988870623369>",
} as const

function compactDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}m`
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

function onOff(enabled: boolean): string {
  return enabled ? `${EMOJI_TAGS.enable} Activé` : `${EMOJI_TAGS.disable} Désactivé`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "Aucun"
}

function roleMention(roleId: string | null): string {
  return roleId ? `<@&${roleId}>` : "Aucun"
}

export function buildCaptchaEmbed(
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

export function buildCaptchaContainer(_client: Client, _guild: Guild, config: CaptchaConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.check} 〃 Captcha`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *À l'arrivée, un code est envoyé dans le salon de vérification. Le rôle est donné après succès.*\n\n` +
        `> **État :** ${onOff(config.enabled)}\n` +
        `> ${EMOJI_TAGS.channel} **Salon :** ${channelMention(config.channelId)}\n` +
        `> ${EMOJI_TAGS.cogUser} **Rôle :** ${roleMention(config.roleId)}\n` +
        `> ${EMOJI_TAGS.cog} **Délai :** \`${formatTime(config.timeout)}\`\n` +
        `> ${EMOJI_TAGS.notes} **Essais :** \`${config.maxAttempts}\`\n` +
        `> ${EMOJI_TAGS.leave} **Expulsion :** ${config.kickOnFail ? `${EMOJI_TAGS.enable} Oui` : `${EMOJI_TAGS.disable} Non`}\n` +
        `> ${EMOJI_TAGS.bot} **Ignorer les bots :** ${config.ignoreBots ? `${EMOJI_TAGS.enable} Oui` : `${EMOJI_TAGS.disable} Non`}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(config.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("cp_toggle")
          .setEmoji(config.enabled ? emoji("disable") : emoji("enable"))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon de vérification**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("cp_channel")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId("cp_channel_clear").setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger).setDisabled(!config.channelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.cogUser} **Rôle vérifié**`))
  container.addActionRowComponents((row) =>
    row.setComponents(new RoleSelectMenuBuilder().setCustomId("cp_role").setPlaceholder("Choisir le rôle...").setMaxValues(1))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le rôle**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId("cp_role_clear").setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger).setDisabled(!config.roleId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Délai**\n> \`${formatTime(config.timeout)}\``))
      .setButtonAccessory((btn) => btn.setCustomId("cp_timeout").setEmoji(emoji("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Essais**\n> \`${config.maxAttempts}\``))
      .setButtonAccessory((btn) => btn.setCustomId("cp_attempts").setEmoji(emoji("notes")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Expulsion en cas d'échec**\n> ${config.kickOnFail ? `Le membre est expulsé ${EMOJI_TAGS.enable}` : `Le membre reste sans le rôle ${EMOJI_TAGS.disable}`}`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("cp_kick")
          .setEmoji(config.kickOnFail ? emoji("enable") : emoji("disable"))
          .setStyle(config.kickOnFail ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Ignorer les bots**\n> ${config.ignoreBots ? `Les bots ne déclenchent pas le captcha ${EMOJI_TAGS.enable}` : `Les bots déclenchent le captcha ${EMOJI_TAGS.disable}`}`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("cp_bots")
          .setEmoji(config.ignoreBots ? emoji("enable") : emoji("disable"))
          .setStyle(config.ignoreBots ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  return [container]
}

function buildTimeoutModal(config: CaptchaConfig): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("timeout")
    .setLabel("Délai (30s, 5m, 1h…)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setPlaceholder("5m")
    .setValue(compactDuration(config.timeout))
  return new ModalBuilder()
    .setCustomId("cp_modal_timeout")
    .setTitle("Délai du captcha")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

function buildAttemptsModal(config: CaptchaConfig): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("attempts")
    .setLabel(`Nombre d'essais (${MIN_ATTEMPTS}–${MAX_ATTEMPTS})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2)
    .setPlaceholder("3")
    .setValue(String(config.maxAttempts))
  return new ModalBuilder()
    .setCustomId("cp_modal_attempts")
    .setTitle("Essais du captcha")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

async function refreshPanel(
  client: Client,
  interaction: MessageComponentInteraction | { update: MessageComponentInteraction["update"]; guild: Guild | null },
  guild: Guild
): Promise<void> {
  const config = await getConfig(guild.id)
  await interaction.update({
    components: buildCaptchaContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export function clampTimeout(ms: number): number {
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Math.floor(ms)))
}

export function clampAttempts(n: number): number {
  return Math.min(MAX_ATTEMPTS, Math.max(MIN_ATTEMPTS, Math.floor(n)))
}

export async function handleCaptchaInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("cp_")) return false
  if (!interaction.inGuild()) return false

  if (customId.startsWith("cp_verify:") || customId.startsWith("cp_modal:")) {
    return handleChallengeInteraction(client, interaction)
  }

  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && customId === "cp_timeout") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildTimeoutModal(config))
    return true
  }

  if (interaction.isButton() && customId === "cp_attempts") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildAttemptsModal(config))
    return true
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false

    if (customId === "cp_modal_timeout") {
      const parsed = parseTime(interaction.fields.getTextInputValue("timeout"))
      if (parsed === null || parsed <= 0) {
        await interaction.reply({
          content: "> *Durée invalide. Exemples : `30s`, `5m`, `1h`.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      await updateConfig(guild.id, { $set: { timeout: clampTimeout(parsed) } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    if (customId === "cp_modal_attempts") {
      const raw = Number(interaction.fields.getTextInputValue("attempts").trim())
      if (!Number.isInteger(raw) || raw < MIN_ATTEMPTS || raw > MAX_ATTEMPTS) {
        await interaction.reply({
          content: `> *Nombre d'essais invalide. Utilisez un entier entre **${MIN_ATTEMPTS}** et **${MAX_ATTEMPTS}**.*`,
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      await updateConfig(guild.id, { $set: { maxAttempts: clampAttempts(raw) } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    return false
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === "cp_toggle") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { enabled: !config.enabled } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "cp_channel_clear") {
    await updateConfig(guild.id, { $set: { channelId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "cp_channel" && interaction.isChannelSelectMenu()) {
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

  if (customId === "cp_role_clear") {
    await updateConfig(guild.id, { $set: { roleId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "cp_role" && interaction.isRoleSelectMenu()) {
    const roleId = interaction.values[0]
    if (roleId === guild.id) {
      await interaction.reply({ content: "> *Le rôle @everyone ne peut pas être utilisé.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $set: { roleId } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "cp_kick") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { kickOnFail: !config.kickOnFail } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "cp_bots") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { ignoreBots: !config.ignoreBots } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  return false
}
