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
import formatTime from "../formatTime.js"
import parseTime from "../parseTime.js"
import {
  MAX_LEVEL,
  MAX_NOTIFY_LENGTH,
  MAX_REWARDS,
  MAX_XP,
  MIN_REWARD_LEVEL,
  MIN_XP,
  clampCooldown,
  clampNotifyMessage,
  clampRewardLevel,
  clampXp,
  getConfig,
  removeReward,
  updateConfig,
  upsertReward,
  type LevelsConfig,
} from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

function compactDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}m`
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

function onOff(enabled: boolean): string {
  return enabled ? `${appEmojiText("power")} Activé` : `${appEmojiText("power")} Désactivé`
}

function yesNo(value: boolean): string {
  return value ? `${appEmojiText("check")} Oui` : `${appEmojiText("cancel")} Non`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "*Salon du message*"
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

function rewardLine(guild: Guild, level: number, roleId: string): string {
  const role = guild.roles.cache.get(roleId)
  return role ? `> Niveau \`${level}\` — ${role}` : `> Niveau \`${level}\` — \`${roleId}\``
}

export function buildLevelsEmbed(
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

export function buildLevelsContainer(_client: Client, guild: Guild, config: LevelsConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("people")} 〃 Niveaux`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Encouragez l'activité sur votre serveur avec un système de niveaux complet.*\n\n` +
        `> ***État :** ${onOff(config.enabled)}*\n` +
        `> ${appEmojiText("cog")} ***XP :** \`${config.xpMin}\`–\`${config.xpMax}\`*\n` +
        `> ${appEmojiText("cog")} ***Cooldown :** \`${formatTime(config.cooldown)}\`*\n` +
        `> ${appEmojiText("file")} ***Notifications :** ${
          config.notifyEnabled ? `${appEmojiText("power")} ${channelMention(config.notifyChannelId)}` : `${appEmojiText("power")} Désactivées`
        }*\n` +
        `> ${appEmojiText("people")} ***Cumul des rôles :** ${yesNo(config.stackRoles)}*\n` +
        `> ${appEmojiText("file")} ***Salons ignorés :** ${
          config.ignoredChannels.length > 0 ? config.ignoredChannels.map((id) => `<#${id}>`).join(" ") : "*Aucun*"
        }*\n` +
        `> ${appEmojiText("people")} ***Rôles ignorés :** ${
          config.ignoredRoles.length > 0 ? config.ignoredRoles.map((id) => `<@&${id}>`).join(" ") : "*Aucun*"
        }*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(config.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("lv_toggle")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**XP par message**\n> \`${config.xpMin}\`–\`${config.xpMax}\``))
      .setButtonAccessory((btn) => btn.setCustomId("lv_xp").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Cooldown**\n> \`${formatTime(config.cooldown)}\``))
      .setButtonAccessory((btn) => btn.setCustomId("lv_cooldown").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Notifications de level-up**\n> ${
            config.notifyEnabled ? `Un message est envoyé ${appEmojiText("check")}` : `Aucun message n'est envoyé ${appEmojiText("cancel")}`
          }`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("lv_notify")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.notifyEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon de notification**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("lv_channel")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Salon du message**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("lv_channel_clear")
          .setEmoji(appEmojiComponent("cancel"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!config.notifyChannelId)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Message**\n> ${truncate(config.notifyMessage, 80)}`))
      .setButtonAccessory((btn) => btn.setCustomId("lv_message").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Cumul des rôles**\n> ${
            config.stackRoles
              ? `Tous les rôles atteints sont conservés ${appEmojiText("check")}`
              : `Seul le rôle le plus élevé est conservé ${appEmojiText("cancel")}`
          }`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("lv_stack")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.stackRoles ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salons ignorés**`))
  container.addActionRowComponents((row) => {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId("lv_ignore")
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
          .setCustomId("lv_ignore_clear")
          .setEmoji(appEmojiComponent("cancel"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(config.ignoredChannels.length === 0)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("people")} **Rôles ignorés**`))
  container.addActionRowComponents((row) => {
    const select = new RoleSelectMenuBuilder()
      .setCustomId("lv_ignore_roles")
      .setPlaceholder("Rôles à ignorer...")
      .setMinValues(0)
      .setMaxValues(25)
    if (config.ignoredRoles.length) select.setDefaultRoles(config.ignoredRoles.slice(0, 25))
    return row.setComponents(select)
  })
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer les rôles ignorés**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("lv_ignore_roles_clear")
          .setEmoji(appEmojiComponent("cancel"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(config.ignoredRoles.length === 0)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  const rewardLines =
    config.rewards.length > 0
      ? config.rewards.slice(0, 8).map((item) => rewardLine(guild, item.level, item.roleId)).join("\n")
      : "> *Aucun rôle de récompense.*"
  container.addTextDisplayComponents((t) =>
    t.setContent(`${appEmojiText("people")} **Rôles de récompense (${config.rewards.length})**\n${rewardLines}`)
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId("lv_reward_add").setPlaceholder("Ajouter un rôle...").setMaxValues(1)
    )
  )
  if (config.rewards.length > 0) {
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("lv_reward_rm")
          .setPlaceholder("Retirer un rôle...")
          .setMinValues(1)
          .setMaxValues(Math.min(config.rewards.length, 25))
          .addOptions(
            config.rewards.slice(0, 25).map((item) => {
              const role = guild.roles.cache.get(item.roleId)
              return {
                label: truncate(role?.name ?? item.roleId, 100) || "Rôle",
                description: `Niveau ${item.level}`.slice(0, 100),
                value: item.roleId,
                emoji: appEmojiOrFallback("people"),
              }
            })
          )
      )
    )
  }
  return [container]
}

function buildXpModal(config: LevelsConfig): ModalBuilder {
  const min = new TextInputBuilder()
    .setCustomId("xpMin")
    .setLabel(`XP minimum (${MIN_XP}–${MAX_XP})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setPlaceholder("15")
    .setValue(String(config.xpMin))
  const max = new TextInputBuilder()
    .setCustomId("xpMax")
    .setLabel(`XP maximum (${MIN_XP}–${MAX_XP})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setPlaceholder("25")
    .setValue(String(config.xpMax))
  return new ModalBuilder()
    .setCustomId("lv_modal_xp")
    .setTitle("XP par message")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(min),
      new ActionRowBuilder<TextInputBuilder>().addComponents(max)
    )
}

function buildCooldownModal(config: LevelsConfig): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("cooldown")
    .setLabel("Cooldown (5s, 1m, 1h…)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setPlaceholder("1m")
    .setValue(compactDuration(config.cooldown))
  return new ModalBuilder()
    .setCustomId("lv_modal_cooldown")
    .setTitle("Cooldown XP")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

function buildMessageModal(config: LevelsConfig): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("message")
    .setLabel("Message ({user}, {level}, {xp})")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_NOTIFY_LENGTH)
    .setPlaceholder(config.notifyMessage)
    .setValue(config.notifyMessage)
  return new ModalBuilder()
    .setCustomId("lv_modal_message")
    .setTitle("Message de level-up")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

function buildRewardModal(roleId: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("level")
    .setLabel(`Niveau (${MIN_REWARD_LEVEL}–${MAX_LEVEL})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(4)
    .setPlaceholder("10")
  return new ModalBuilder()
    .setCustomId(`lv_reward_modal:${roleId}`)
    .setTitle("Niveau du rôle")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

async function refreshPanel(
  client: Client,
  interaction: MessageComponentInteraction | { update: MessageComponentInteraction["update"]; guild: Guild | null },
  guild: Guild
): Promise<void> {
  const config = await getConfig(guild.id)
  await interaction.update({
    components: buildLevelsContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export async function handleLevelsInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("lv_")) return false
  if (!interaction.inGuild()) return false
  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && customId === "lv_xp") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildXpModal(config))
    return true
  }

  if (interaction.isButton() && customId === "lv_cooldown") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildCooldownModal(config))
    return true
  }

  if (interaction.isButton() && customId === "lv_message") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildMessageModal(config))
    return true
  }

  if (interaction.isRoleSelectMenu() && customId === "lv_reward_add") {
    const roleId = interaction.values[0]
    if (!roleId || roleId === guild.id) {
      await interaction.reply({ content: "> *Le rôle @everyone ne peut pas être utilisé.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const config = await getConfig(guild.id)
    if (config.rewards.length >= MAX_REWARDS && !config.rewards.some((item) => item.roleId === roleId)) {
      await interaction.reply({
        content: `> *Maximum **${MAX_REWARDS}** rôles de récompense.*`,
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    await interaction.showModal(buildRewardModal(roleId))
    return true
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false

    if (customId === "lv_modal_xp") {
      const minRaw = Number(interaction.fields.getTextInputValue("xpMin").trim())
      const maxRaw = Number(interaction.fields.getTextInputValue("xpMax").trim())
      if (!Number.isInteger(minRaw) || !Number.isInteger(maxRaw) || minRaw < MIN_XP || maxRaw < MIN_XP) {
        await interaction.reply({
          content: `> *XP invalide. Utilisez des entiers entre **${MIN_XP}** et **${MAX_XP}**.*`,
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      let xpMin = clampXp(minRaw)
      let xpMax = clampXp(maxRaw)
      if (xpMin > xpMax) {
        const swap = xpMin
        xpMin = xpMax
        xpMax = swap
      }
      await updateConfig(guild.id, { $set: { xpMin, xpMax } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    if (customId === "lv_modal_cooldown") {
      const parsed = parseTime(interaction.fields.getTextInputValue("cooldown"))
      if (parsed === null || parsed <= 0) {
        await interaction.reply({
          content: "> *Durée invalide. Exemples : `30s`, `1m`, `5m`.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      await updateConfig(guild.id, { $set: { cooldown: clampCooldown(parsed) } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    if (customId === "lv_modal_message") {
      const notifyMessage = clampNotifyMessage(interaction.fields.getTextInputValue("message"))
      await updateConfig(guild.id, { $set: { notifyMessage } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    if (customId.startsWith("lv_reward_modal:")) {
      const roleId = customId.slice("lv_reward_modal:".length)
      if (!/^\d{17,20}$/.test(roleId) || roleId === guild.id) {
        await interaction.reply({ content: "> *Rôle invalide.*", flags: MessageFlags.Ephemeral })
        return true
      }
      const raw = Number(interaction.fields.getTextInputValue("level").trim())
      if (!Number.isInteger(raw) || raw < MIN_REWARD_LEVEL || raw > MAX_LEVEL) {
        await interaction.reply({
          content: `> *Niveau invalide. Utilisez un entier entre **${MIN_REWARD_LEVEL}** et **${MAX_LEVEL}**.*`,
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const config = await getConfig(guild.id)
      await updateConfig(guild.id, { $set: { rewards: upsertReward(config.rewards, roleId, clampRewardLevel(raw)) } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    return false
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === "lv_toggle") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { enabled: !config.enabled } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_notify") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { notifyEnabled: !config.notifyEnabled } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_stack") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { stackRoles: !config.stackRoles } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_channel_clear") {
    await updateConfig(guild.id, { $set: { notifyChannelId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_channel" && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({ content: "> *Le salon doit être un salon textuel du serveur.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $set: { notifyChannelId: channelId } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_ignore" && interaction.isChannelSelectMenu()) {
    await updateConfig(guild.id, { $set: { ignoredChannels: interaction.values.slice(0, 25) } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_ignore_clear") {
    await updateConfig(guild.id, { $set: { ignoredChannels: [] } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_ignore_roles" && interaction.isRoleSelectMenu()) {
    const ids = interaction.values.filter((id) => id !== guild.id).slice(0, 25)
    await updateConfig(guild.id, { $set: { ignoredRoles: ids } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_ignore_roles_clear") {
    await updateConfig(guild.id, { $set: { ignoredRoles: [] } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "lv_reward_rm" && interaction.isStringSelectMenu()) {
    const config = await getConfig(guild.id)
    let rewards = config.rewards
    for (const roleId of interaction.values) rewards = removeReward(rewards, roleId)
    await updateConfig(guild.id, { $set: { rewards } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  return false
}
