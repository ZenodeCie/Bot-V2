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
  type GuildTextBasedChannel,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import parseTime from "../parseTime.js"
import {
  cancelGiveaway,
  endGiveaway,
  handleEnterInteraction,
  rerollGiveaway,
  startGiveaway,
} from "./engine.js"
import { COMPONENTS_V2_FLAGS, CONTAINER_ACCENT, EMOJI_TAGS, buildNoticeContainer, emoji, noticePayload } from "./notice.js"
import {
  MAX_WINNERS,
  MIN_WINNERS,
  clampDuration,
  clampPrize,
  clampWinners,
  getConfig,
  getGiveaway,
  listActiveGiveaways,
  updateConfig,
  type GiveawayConfig,
  type GiveawayRecord,
} from "./schema.js"

export { COMPONENTS_V2_FLAGS, buildNoticeContainer, noticePayload } from "./notice.js"

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "*Aucun*"
}

function roleMention(roleId: string | null): string {
  return roleId ? `<@&${roleId}>` : "*Aucun*"
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

async function requireManageGuild(interaction: Interaction): Promise<boolean> {
  const member = interaction.member
  const memberPermissions =
    member && typeof member.permissions === "object" && member.permissions !== null ? member.permissions : null
  if (!member || !memberPermissions || !memberPermissions.has("ManageGuild")) {
    if (interaction.isRepliable()) {
      await interaction.reply(
        noticePayload("disable", "Permission manquante", "> *Cette action nécessite la permission **Gérer le serveur**.*", {
          ephemeral: true,
        })
      )
    }
    return false
  }
  return true
}

function buildManageRow(id: string, state: "active" | "ended" | "cancelled"): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw_end:${id}`)
      .setLabel("Terminer")
      .setEmoji(emoji("check"))
      .setStyle(ButtonStyle.Success)
      .setDisabled(state !== "active"),
    new ButtonBuilder()
      .setCustomId(`gw_reroll:${id}`)
      .setLabel("Relancer")
      .setEmoji(emoji("loop"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state !== "ended"),
    new ButtonBuilder()
      .setCustomId(`gw_cancel:${id}`)
      .setLabel("Annuler")
      .setEmoji(emoji("disable"))
      .setStyle(ButtonStyle.Danger)
      .setDisabled(state !== "active")
  )
}

function formatActiveLine(giveaway: GiveawayRecord): string {
  return (
    `> ${EMOJI_TAGS.party} **${truncate(giveaway.prize, 48)}** — <#${giveaway.channelId}> — ` +
    `<t:${Math.floor(giveaway.endsAt / 1000)}:R> — \`${giveaway.participants.length}\` participant${giveaway.participants.length > 1 ? "s" : ""}`
  )
}

export function buildGiveawayContainer(
  _client: Client,
  _guild: Guild,
  config: GiveawayConfig,
  active: GiveawayRecord[]
): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.party} 〃 Giveaway`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Lancez un giveaway, les membres participent via un bouton. Les tirages et messages sont repris après un redémarrage.*\n\n` +
        `> ${EMOJI_TAGS.channel} ***Salon par défaut :** ${channelMention(config.defaultChannelId)}*\n` +
        `> ${EMOJI_TAGS.people} ***Gagnants par défaut :** \`${config.defaultWinnerCount}\`*\n` +
        `> ${EMOJI_TAGS.cogUser} ***Rôle requis :** ${roleMention(config.requiredRoleId)}*\n` +
        `> ${EMOJI_TAGS.notes} ***En cours :** \`${active.length}\`*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Créer un giveaway**\n> Ouvre un formulaire (prix, durée, gagnants)."))
      .setButtonAccessory((btn) => btn.setCustomId("gw_create").setEmoji(emoji("party")).setStyle(ButtonStyle.Success))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon par défaut**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("gw_channel")
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le salon**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("gw_channel_clear")
          .setEmoji(emoji("disable"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!config.defaultChannelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.cogUser} **Rôle requis par défaut**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId("gw_role").setPlaceholder("Choisir le rôle...").setMaxValues(1)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retirer le rôle**"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("gw_role_clear")
          .setEmoji(emoji("disable"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!config.requiredRoleId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Gagnants par défaut**\n> \`${config.defaultWinnerCount}\``))
      .setButtonAccessory((btn) => btn.setCustomId("gw_winners").setEmoji(emoji("people")).setStyle(ButtonStyle.Secondary))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  if (active.length === 0) {
    container.addTextDisplayComponents((t) =>
      t.setContent(`${EMOJI_TAGS.notes} **Giveaways en cours**\n> *Aucun giveaway actif.*`)
    )
  } else {
    container.addTextDisplayComponents((t) =>
      t.setContent(
        `${EMOJI_TAGS.notes} **Giveaways en cours (${active.length})**\n` +
          active.slice(0, 8).map(formatActiveLine).join("\n")
      )
    )
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("gw_pick")
          .setPlaceholder("Gérer un giveaway...")
          .setMaxValues(1)
          .addOptions(
            active.slice(0, 25).map((giveaway) => ({
              label: truncate(giveaway.prize, 100) || "Giveaway",
              description: truncate(
                `${giveaway.participants.length} participant${giveaway.participants.length > 1 ? "s" : ""} · ${giveaway.winnerCount} gagnant${giveaway.winnerCount > 1 ? "s" : ""}`,
                100
              ),
              value: giveaway.id,
              emoji: emoji("party"),
            }))
          )
      )
    )
  }
  return [container]
}

function buildCreateModal(config: GiveawayConfig): ModalBuilder {
  const prize = new TextInputBuilder()
    .setCustomId("prize")
    .setLabel("Prix")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256)
    .setPlaceholder("Nitro, un rôle, des coins…")
  const duration = new TextInputBuilder()
    .setCustomId("duration")
    .setLabel("Durée (10s, 5m, 1h, 1d, 1w…)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setPlaceholder("1h")
  const winners = new TextInputBuilder()
    .setCustomId("winners")
    .setLabel(`Gagnants (${MIN_WINNERS}–${MAX_WINNERS})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2)
    .setPlaceholder(String(config.defaultWinnerCount))
    .setValue(String(config.defaultWinnerCount))
  return new ModalBuilder()
    .setCustomId("gw_modal_create")
    .setTitle("Créer un giveaway")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(prize),
      new ActionRowBuilder<TextInputBuilder>().addComponents(duration),
      new ActionRowBuilder<TextInputBuilder>().addComponents(winners)
    )
}

function buildWinnersModal(config: GiveawayConfig): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("winners")
    .setLabel(`Nombre de gagnants (${MIN_WINNERS}–${MAX_WINNERS})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2)
    .setPlaceholder("1")
    .setValue(String(config.defaultWinnerCount))
  return new ModalBuilder()
    .setCustomId("gw_modal_winners")
    .setTitle("Gagnants par défaut")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

async function refreshPanel(
  client: Client,
  interaction: MessageComponentInteraction | { update: MessageComponentInteraction["update"]; guild: Guild | null },
  guild: Guild
): Promise<void> {
  const [config, active] = await Promise.all([getConfig(guild.id), listActiveGiveaways(guild.id)])
  await interaction.update({
    components: buildGiveawayContainer(client, guild, config, active),
    flags: COMPONENTS_V2_FLAGS,
  })
}

async function resolveCreateChannel(guild: Guild, interaction: Interaction): Promise<GuildTextBasedChannel | null> {
  const config = await getConfig(guild.id)
  const channelId = config.defaultChannelId ?? interaction.channelId
  if (!channelId) return null
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null))
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null
  return channel
}

export async function handleGiveawayInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("gw_")) return false
  if (!interaction.inGuild()) return false

  if (customId.startsWith("gw_enter:")) {
    return handleEnterInteraction(client, interaction)
  }

  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && customId === "gw_create") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildCreateModal(config))
    return true
  }

  if (interaction.isButton() && customId === "gw_winners") {
    const config = await getConfig(guild.id)
    await interaction.showModal(buildWinnersModal(config))
    return true
  }

  if (interaction.isStringSelectMenu() && customId === "gw_pick") {
    const id = interaction.values[0]
    const giveaway = id ? await getGiveaway(id) : null
    if (!giveaway || giveaway.guildId !== guild.id || giveaway.ended || giveaway.cancelled) {
      await interaction.reply(
        noticePayload("disable", "Giveaway introuvable", "> *Giveaway introuvable ou déjà terminé.*", { ephemeral: true })
      )
      return true
    }
    const manageBody =
      `> ${EMOJI_TAGS.party} ***Prix :** ${giveaway.prize}*\n` +
      `> ${EMOJI_TAGS.channel} ***Salon :** <#${giveaway.channelId}>*\n` +
      `> ${EMOJI_TAGS.people} ***Participants :** \`${giveaway.participants.length}\` — **Gagnants :** \`${giveaway.winnerCount}\`*\n` +
      `> ${EMOJI_TAGS.duration} ***Fin :** <t:${Math.floor(giveaway.endsAt / 1000)}:R>*`
    await interaction.reply(
      noticePayload("cogUser", "Gérer un giveaway", manageBody, {
        ephemeral: true,
        rows: [buildManageRow(giveaway.id, "active")],
      })
    )
    return true
  }

  if (interaction.isButton() && customId.startsWith("gw_end:")) {
    const id = customId.slice("gw_end:".length)
    const result = await endGiveaway(client, id)
    if (!result.ok) {
      await interaction.reply(noticePayload("disable", "Action impossible", result.error, { ephemeral: true }))
      return true
    }
    await interaction.update({
      ...noticePayload("check", "Giveaway terminé", `> *Giveaway **${result.giveaway.prize}** terminé.*`, {
        rows: [buildManageRow(id, "ended")],
      }),
    })
    return true
  }

  if (interaction.isButton() && customId.startsWith("gw_reroll:")) {
    const result = await rerollGiveaway(client, customId.slice("gw_reroll:".length))
    if (!result.ok) {
      await interaction.reply(noticePayload("disable", "Action impossible", result.error, { ephemeral: true }))
      return true
    }
    const winners =
      result.giveaway.winners.length > 0
        ? result.giveaway.winners.map((userId) => `<@${userId}>`).join(", ")
        : "*Aucun*"
    await interaction.update({
      ...noticePayload(
        "loop",
        "Nouveau tirage",
        `> *Nouveau tirage pour **${result.giveaway.prize}** : ${winners}.*`,
        { rows: [buildManageRow(result.giveaway.id, "ended")] }
      ),
    })
    return true
  }

  if (interaction.isButton() && customId.startsWith("gw_cancel:")) {
    const id = customId.slice("gw_cancel:".length)
    const result = await cancelGiveaway(client, id)
    if (!result.ok) {
      await interaction.reply(noticePayload("disable", "Action impossible", result.error, { ephemeral: true }))
      return true
    }
    await interaction.update({
      ...noticePayload("disable", "Giveaway annulé", `> *Giveaway **${result.giveaway.prize}** annulé.*`, {
        rows: [buildManageRow(id, "cancelled")],
      }),
    })
    return true
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false

    if (customId === "gw_modal_winners") {
      const raw = Number(interaction.fields.getTextInputValue("winners").trim())
      if (!Number.isInteger(raw) || raw < MIN_WINNERS || raw > MAX_WINNERS) {
        await interaction.reply(
          noticePayload(
            "disable",
            "Valeur invalide",
            `> *Nombre de gagnants invalide. Utilisez un entier entre **${MIN_WINNERS}** et **${MAX_WINNERS}**.*`,
            { ephemeral: true }
          )
        )
        return true
      }
      await updateConfig(guild.id, { $set: { defaultWinnerCount: clampWinners(raw) } })
      await refreshPanel(client, interaction, guild)
      return true
    }

    if (customId === "gw_modal_create") {
      const prize = clampPrize(interaction.fields.getTextInputValue("prize"))
      const parsed = parseTime(interaction.fields.getTextInputValue("duration").trim())
      const winnersRaw = interaction.fields.getTextInputValue("winners").trim()
      if (!prize) {
        await interaction.reply(noticePayload("disable", "Valeur invalide", "> *Indiquez un prix.*", { ephemeral: true }))
        return true
      }
      if (parsed === null || parsed <= 0) {
        await interaction.reply(
          noticePayload("disable", "Durée invalide", "> *Durée invalide. Exemples : `30s`, `5m`, `1h`, `1d`.*", {
            ephemeral: true,
          })
        )
        return true
      }
      const config = await getConfig(guild.id)
      let winnerCount = config.defaultWinnerCount
      if (winnersRaw) {
        const raw = Number(winnersRaw)
        if (!Number.isInteger(raw) || raw < MIN_WINNERS || raw > MAX_WINNERS) {
          await interaction.reply(
            noticePayload(
              "disable",
              "Valeur invalide",
              `> *Nombre de gagnants invalide. Utilisez un entier entre **${MIN_WINNERS}** et **${MAX_WINNERS}**.*`,
              { ephemeral: true }
            )
          )
          return true
        }
        winnerCount = clampWinners(raw)
      }
      const channel = await resolveCreateChannel(guild, interaction)
      if (!channel) {
        await interaction.reply(
          noticePayload(
            "disable",
            "Salon introuvable",
            "> *Aucun salon valide. Configurez un salon par défaut ou utilisez la commande dans un salon textuel.*",
            { ephemeral: true }
          )
        )
        return true
      }
      const result = await startGiveaway({
        client,
        guildId: guild.id,
        channel,
        hostId: interaction.user.id,
        prize,
        duration: clampDuration(parsed),
        winnerCount,
        requiredRoleId: config.requiredRoleId,
      })
      if (!result.ok) {
        await interaction.reply(noticePayload("disable", "Action impossible", result.error, { ephemeral: true }))
        return true
      }
      await refreshPanel(client, interaction, guild)
      await interaction
        .followUp(
          noticePayload(
            "party",
            "Giveaway lancé",
            `> *Giveaway **${result.giveaway.prize}** lancé dans <#${result.giveaway.channelId}>.*`,
            { ephemeral: true }
          )
        )
        .catch(() => undefined)
      return true
    }

    return false
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === "gw_channel_clear") {
    await updateConfig(guild.id, { $set: { defaultChannelId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "gw_channel" && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply(
        noticePayload("disable", "Salon invalide", "> *Le salon doit être un salon textuel du serveur.*", {
          ephemeral: true,
        })
      )
      return true
    }
    await updateConfig(guild.id, { $set: { defaultChannelId: channelId } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "gw_role_clear") {
    await updateConfig(guild.id, { $set: { requiredRoleId: null } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  if (customId === "gw_role" && interaction.isRoleSelectMenu()) {
    const roleId = interaction.values[0]
    if (roleId === guild.id) {
      await interaction.reply(
        noticePayload("disable", "Rôle invalide", "> *Le rôle @everyone ne peut pas être utilisé.*", { ephemeral: true })
      )
      return true
    }
    await updateConfig(guild.id, { $set: { requiredRoleId: roleId } })
    await refreshPanel(client, interaction, guild)
    return true
  }

  return false
}
