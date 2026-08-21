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
  MAX_REWARDS,
  MAX_REWARD_INVITES,
  MIN_REWARD_INVITES,
  clampFakeAge,
  clampRewardInvites,
  getConfig,
  removeReward,
  updateConfig,
  upsertReward,
  type InvitationsConfig,
} from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

function compactDuration(ms: number): string {
  if (ms <= 0) return "off"
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`
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
  return channelId ? `<#${channelId}>` : "*Aucun*"
}

function fakeAgeLabel(ms: number): string {
  return ms <= 0 ? `${appEmojiText("power")} Désactivé` : `\`${formatTime(ms)}\``
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

function rewardLine(guild: Guild, invites: number, roleId: string): string {
  const role = guild.roles.cache.get(roleId)
  return role ? `> \`${invites}\` invites — ${role}` : `> \`${invites}\` invites — \`${roleId}\``
}

export function buildInvitationsEmbed(
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

export function buildInvitationsContainer(_client: Client, guild: Guild, config: InvitationsConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("people")} 〃 Invitations`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Suivez qui invite qui, via quel lien, et récompensez les meilleurs inviteurs.*\n\n` +
        `> ***État :** ${onOff(config.enabled)}*\n` +
        `> ${appEmojiText("file")} ***Salon de logs :** ${channelMention(config.logChannelId)}*\n` +
        `> ${appEmojiText("cog")} ***Comptes fake :** ${fakeAgeLabel(config.fakeAge)}*\n` +
        `> ${appEmojiText("people")} ***Ignorer les bots :** ${yesNo(config.ignoreBots)}*\n` +
        `> ${appEmojiText("loop")} ***Compter les rejoins :** ${yesNo(config.countRejoins)}*\n` +
        `> ${appEmojiText("people")} ***Cumul des rôles :** ${yesNo(config.stackRoles)}*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(config.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("in_toggle")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("file")} **Salon de logs**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("in_channel")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId("in_channel_clear").setEmoji(appEmojiComponent("cancel")).setStyle(ButtonStyle.Danger).setDisabled(!config.logChannelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Âge des comptes fake**\n> ${fakeAgeLabel(config.fakeAge)}`))
      .setButtonAccessory((btn) => btn.setCustomId("in_fake").setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Ignorer les bots**\n> ${
            config.ignoreBots ? `Les bots ne sont pas comptés ${appEmojiText("check")}` : `Les bots sont comptés ${appEmojiText("cancel")}`
          }`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("in_bots")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.ignoreBots ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Compter les rejoins**\n> ${
            config.countRejoins
              ? `Un membre qui revient donne une nouvelle invite ${appEmojiText("check")}`
              : `Un membre qui revient n'est pas recompté ${appEmojiText("cancel")}`
          }`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("in_rejoins")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.countRejoins ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
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
          .setCustomId("in_stack")
          .setEmoji(appEmojiComponent("power"))
          .setStyle(config.stackRoles ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  const rewardLines =
    config.rewards.length > 0
      ? config.rewards.slice(0, 8).map((item) => rewardLine(guild, item.invites, item.roleId)).join("\n")
      : "> *Aucun rôle de récompense.*"
  container.addTextDisplayComponents((t) =>
    t.setContent(`${appEmojiText("people")} **Rôles de récompense (${config.rewards.length})**\n${rewardLines}`)
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId("in_reward_add").setPlaceholder("Ajouter un rôle...").setMaxValues(1)
    )
  )
  if (config.rewards.length > 0) {
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("in_reward_rm")
          .setPlaceholder("Retirer un rôle...")
          .setMinValues(1)
          .setMaxValues(Math.min(config.rewards.length, 25))
          .addOptions(
            config.rewards.slice(0, 25).map((item) => {
              const role = guild.roles.cache.get(item.roleId)
              return {
                label: truncate(role?.name ?? item.roleId, 100) || "Rôle",
                description: `${item.invites} invites`.slice(0, 100),
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

function buildFakeModal(config: InvitationsConfig): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("fakeAge")
    .setLabel("Âge max (7d, 24h, off…)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setPlaceholder("7d")
    .setValue(compactDuration(config.fakeAge))
  return new ModalBuilder()
    .setCustomId("in_modal_fake")
    .setTitle("Comptes fake")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

function buildRewardModal(roleId: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("invites")
    .setLabel(`Invites requises (${MIN_REWARD_INVITES}–${MAX_REWARD_INVITES})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(5)
    .setPlaceholder("10")
  return new ModalBuilder()
    .setCustomId(`in_reward_modal:${roleId}`)
    .setTitle("Seuil du rôle")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

async function refreshPanel(
  client: Client,
  interaction: MessageComponentInteraction | { update: MessageComponentInteraction["update"]; guild: Guild | null },
  guild: Guild
): Promise<void> {
  const config = await getConfig(guild.id)
  await interaction.update({
    components: buildInvitationsContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export async function handleInvitationsInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("in_")) return false
  if (!interaction.inGuild()) return false
  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && customId === "in_fake") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildFakeModal(config))
    return true
  }

  if (interaction.isRoleSelectMenu() && customId === "in_reward_add") {
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

    if (customId === "in_modal_fake") {
      const raw = interaction.fields.getTextInputValue("fakeAge").trim().toLowerCase()
      if (["off", "disable", "none", "aucun", "0"].includes(raw)) {
        await updateConfig(guild.id, { $set: { fakeAge: 0 } })
        await refreshPanel(client, interaction, guild)
        return true
      }
      const parsed = parseTime(raw)
      if (parsed === null || parsed < 0) {
        await interaction.reply({
          content: "> *Durée invalide. Exemples : `7d`, `24h`, `off`.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      await updateConfig(guild.id, { $set: { fakeAge: clampFakeAge(parsed) } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    if (customId.startsWith("in_reward_modal:")) {
      const roleId = customId.slice("in_reward_modal:".length)
      if (!/^\d{17,20}$/.test(roleId) || roleId === guild.id) {
        await interaction.reply({ content: "> *Rôle invalide.*", flags: MessageFlags.Ephemeral })
        return true
      }
      const raw = Number(interaction.fields.getTextInputValue("invites").trim())
      if (!Number.isInteger(raw) || raw < MIN_REWARD_INVITES || raw > MAX_REWARD_INVITES) {
        await interaction.reply({
          content: `> *Nombre invalide. Utilisez un entier entre **${MIN_REWARD_INVITES}** et **${MAX_REWARD_INVITES}**.*`,
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const config = await getConfig(guild.id)
      await updateConfig(guild.id, { $set: { rewards: upsertReward(config.rewards, roleId, clampRewardInvites(raw)) } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    return false
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === "in_toggle") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { enabled: !config.enabled } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "in_channel_clear") {
    await updateConfig(guild.id, { $set: { logChannelId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "in_channel" && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({ content: "> *Le salon doit être un salon textuel du serveur.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $set: { logChannelId: channelId } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "in_bots") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { ignoreBots: !config.ignoreBots } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "in_rejoins") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { countRejoins: !config.countRejoins } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "in_stack") {
    const config = await getConfig(guild.id)
    await updateConfig(guild.id, { $set: { stackRoles: !config.stackRoles } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "in_reward_rm" && interaction.isStringSelectMenu()) {
    const config = await getConfig(guild.id)
    let rewards = config.rewards
    for (const roleId of interaction.values) rewards = removeReward(rewards, roleId)
    await updateConfig(guild.id, { $set: { rewards } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  return false
}
