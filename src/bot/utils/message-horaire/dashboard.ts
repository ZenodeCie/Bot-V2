import {
  ActionRowBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import { colors } from "../../config.js"
import formatTime from "../formatTime.js"
import parseTime from "../parseTime.js"
import {
  buildJobPayload,
  createJob,
  removeJob,
  rescheduleJob,
  setJobEnabled,
} from "./engine.js"
import {
  clampContent,
  clampDescription,
  clampInterval,
  clampTitle,
  defaultEmbed,
  getConfig,
  getJob,
  hasSendablePayload,
  listJobs,
  parseOptionalColor,
  updateConfig,
  updateJob,
  type MessageHoraireConfig,
  type MessageHoraireJob,
} from "./schema.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e

const EMOJI_IDS = {
  channel: "1469692104589705376",
  check: "1469692151251341425",
  cog: "1469692155680526427",
  color: "1469692171706962071",
  disable: "1469692191298556099",
  duration: "1469692196331458704",
  enable: "1469692252988116992",
  eye: "1469692577384235161",
  notes: "1469692988870623369",
  pen: "1469693057497563160",
} as const

const emoji = (key: keyof typeof EMOJI_IDS): { id: string } => ({ id: EMOJI_IDS[key] })

const EMOJI_TAGS = {
  channel: "<:Channel:1469692104589705376>",
  check: "<:Check:1469692151251341425>",
  cog: "<:Cog:1469692155680526427>",
  disable: "<:Disable:1469692191298556099>",
  duration: "<:Duration:1469692196331458704>",
  enable: "<:Enable:1469692252988116992>",
  eye: "<:Eye:1469692577384235161>",
  notes: "<:Notes:1469692988870623369>",
} as const

function compactDuration(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}m`
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

function onOff(enabled: boolean): string {
  return enabled ? `${EMOJI_TAGS.enable} Activé` : `${EMOJI_TAGS.disable} Désactivé`
}

function channelMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "*Aucun*"
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

function previewText(value: string, max = 80): string {
  const one = value.replace(/\s+/g, " ").trim()
  if (!one) return "*Vide*"
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function jobLabel(job: MessageHoraireJob): string {
  return (
    truncate(job.content, 40) ||
    truncate(job.embed.title, 40) ||
    truncate(job.embed.description, 40) ||
    "Message horaire"
  )
}

function formatJobLine(job: MessageHoraireJob): string {
  return (
    `> ${job.enabled ? EMOJI_TAGS.enable : EMOJI_TAGS.disable} **${truncate(jobLabel(job), 48)}** — <#${job.channelId}> — ` +
    `\`${formatTime(job.interval)}\` — <t:${Math.floor(job.nextAt / 1000)}:R>`
  )
}

export function buildMessageHoraireEmbed(
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

function buildHomeContainer(config: MessageHoraireConfig, jobs: MessageHoraireJob[]): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.duration} 〃 Messages horaires`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Programmez vos messages (ou embeds) pour qu'ils soient envoyés régulièrement dans un salon.*\n\n` +
        `> ${EMOJI_TAGS.channel} ***Salon par défaut :** ${channelMention(config.defaultChannelId)}*\n` +
        `> ${EMOJI_TAGS.notes} ***Messages :** \`${jobs.length}\`*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Créer un message**\n> Ouvre un formulaire (contenu, intervalle)."))
      .setButtonAccessory((btn) => btn.setCustomId("mh_create").setEmoji(emoji("enable")).setStyle(ButtonStyle.Success))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon par défaut**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("mh_channel")
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
          .setCustomId("mh_channel_clear")
          .setEmoji(emoji("disable"))
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!config.defaultChannelId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  if (jobs.length === 0) {
    container.addTextDisplayComponents((t) =>
      t.setContent(`${EMOJI_TAGS.notes} **Messages programmés**\n> *Aucun message horaire.*`)
    )
  } else {
    container.addTextDisplayComponents((t) =>
      t.setContent(`${EMOJI_TAGS.notes} **Messages programmés (${jobs.length})**\n` + jobs.map(formatJobLine).join("\n"))
    )
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("mh_pick")
          .setPlaceholder("Gérer un message...")
          .setMaxValues(1)
          .addOptions(
            jobs.slice(0, 25).map((job) => ({
              label: truncate(jobLabel(job), 100) || "Message horaire",
              description: truncate(
                `${job.enabled ? "Activé" : "Désactivé"} · ${compactDuration(job.interval)}`,
                100
              ),
              value: job.id,
              emoji: job.enabled ? emoji("enable") : emoji("disable"),
            }))
          )
      )
    )
  }
  return [container]
}

function buildJobContainer(job: MessageHoraireJob): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.duration} 〃 Message horaire`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> **État :** ${onOff(job.enabled)}\n` +
        `> ${EMOJI_TAGS.channel} **Salon :** <#${job.channelId}>\n` +
        `> ${EMOJI_TAGS.cog} **Intervalle :** \`${formatTime(job.interval)}\`\n` +
        `> ${EMOJI_TAGS.duration} **Prochain envoi :** <t:${Math.floor(job.nextAt / 1000)}:R>\n` +
        `> ${EMOJI_TAGS.notes} **Contenu :** ${previewText(job.content)}\n` +
        `> **Embed :** ${job.embed.enabled ? `${EMOJI_TAGS.enable} ${previewText(job.embed.title || job.embed.description)}` : onOff(false)}`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${onOff(job.enabled)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`mh_toggle:${job.id}`)
          .setEmoji(job.enabled ? emoji("disable") : emoji("enable"))
          .setStyle(job.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`mh_job_channel:${job.id}`)
        .setPlaceholder("Choisir le salon...")
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Intervalle**\n> \`${formatTime(job.interval)}\``))
      .setButtonAccessory((btn) =>
        btn.setCustomId(`mh_interval:${job.id}`).setEmoji(emoji("cog")).setStyle(ButtonStyle.Secondary)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Contenu**\n> ${previewText(job.content)}`))
      .setButtonAccessory((btn) =>
        btn.setCustomId(`mh_content:${job.id}`).setEmoji(emoji("pen")).setStyle(ButtonStyle.Secondary)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Embed**\n> ${job.embed.enabled ? `${EMOJI_TAGS.enable} Activé` : `${EMOJI_TAGS.disable} Désactivé`}`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`mh_embed_toggle:${job.id}`)
          .setEmoji(job.embed.enabled ? emoji("enable") : emoji("disable"))
          .setStyle(job.embed.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Modifier l'embed**\n> Titre, description et couleur."))
      .setButtonAccessory((btn) =>
        btn.setCustomId(`mh_embed_edit:${job.id}`).setEmoji(emoji("color")).setStyle(ButtonStyle.Secondary)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Aperçu**\n> Envoie un aperçu éphémère."))
      .setButtonAccessory((btn) =>
        btn.setCustomId(`mh_preview:${job.id}`).setEmoji(emoji("eye")).setStyle(ButtonStyle.Secondary)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Supprimer**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId(`mh_delete:${job.id}`).setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Retour**"))
      .setButtonAccessory((btn) => btn.setCustomId("mh_back").setEmoji(emoji("notes")).setStyle(ButtonStyle.Secondary))
  )
  return [container]
}

export function buildMessageHoraireContainer(
  _client: Client,
  _guild: Guild,
  config: MessageHoraireConfig,
  jobs: MessageHoraireJob[],
  selected: MessageHoraireJob | null = null
): ContainerBuilder[] {
  if (selected) return buildJobContainer(selected)
  return buildHomeContainer(config, jobs)
}

function buildCreateModal(): ModalBuilder {
  const content = new TextInputBuilder()
    .setCustomId("content")
    .setLabel("Message")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setPlaceholder("Le message envoyé à chaque intervalle.")
  const duration = new TextInputBuilder()
    .setCustomId("interval")
    .setLabel("Intervalle (1m, 5m, 1h, 1d…)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setPlaceholder("1h")
  return new ModalBuilder()
    .setCustomId("mh_modal_create")
    .setTitle("Créer un message horaire")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(content),
      new ActionRowBuilder<TextInputBuilder>().addComponents(duration)
    )
}

function buildIntervalModal(job: MessageHoraireJob): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("interval")
    .setLabel("Intervalle (1m, 5m, 1h, 1d…)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setPlaceholder("1h")
    .setValue(compactDuration(job.interval))
  return new ModalBuilder()
    .setCustomId(`mh_modal_interval:${job.id}`)
    .setTitle("Intervalle")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

function buildContentModal(job: MessageHoraireJob): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("content")
    .setLabel("Message")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000)
    .setPlaceholder("Texte du message (optionnel si embed)")
    .setValue(job.content.slice(0, 2000))
  return new ModalBuilder()
    .setCustomId(`mh_modal_content:${job.id}`)
    .setTitle("Contenu")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

function buildEmbedModal(job: MessageHoraireJob): ModalBuilder {
  const title = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Titre")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256)
    .setValue(job.embed.title.slice(0, 256))
  const description = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Description")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setValue(job.embed.description.slice(0, 4000))
  const color = new TextInputBuilder()
    .setCustomId("color")
    .setLabel("Couleur (#RRGGBB)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(7)
    .setPlaceholder("#5865f2")
    .setValue(job.embed.color ?? "")
  return new ModalBuilder()
    .setCustomId(`mh_modal_embed:${job.id}`)
    .setTitle("Embed")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(title),
      new ActionRowBuilder<TextInputBuilder>().addComponents(description),
      new ActionRowBuilder<TextInputBuilder>().addComponents(color)
    )
}

async function refreshPanel(
  client: Client,
  interaction: MessageComponentInteraction | { update: MessageComponentInteraction["update"]; guild: Guild | null },
  guild: Guild,
  selectedId: string | null = null
): Promise<void> {
  const [config, jobs] = await Promise.all([getConfig(guild.id), listJobs(guild.id)])
  const selected = selectedId ? (jobs.find((job) => job.id === selectedId) ?? null) : null
  await interaction.update({
    components: buildMessageHoraireContainer(client, guild, config, jobs, selected),
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

function jobIdFrom(customId: string, prefix: string): string | null {
  if (!customId.startsWith(prefix)) return null
  const id = customId.slice(prefix.length)
  return id || null
}

export async function handleMessageHoraireInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("mh_")) return false
  if (!interaction.inGuild()) return false
  if (!(await requireManageGuild(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false

  if (interaction.isButton() && customId === "mh_create") {
    await interaction.showModal(buildCreateModal())
    return true
  }

  if (interaction.isButton() && customId === "mh_back") {
    await refreshPanel(client, interaction, guild, null)
    return true
  }

  const intervalId = jobIdFrom(customId, "mh_interval:")
  if (interaction.isButton() && intervalId) {
    const job = await getJob(intervalId)
    if (!job || job.guildId !== guild.id) {
      await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await interaction.showModal(buildIntervalModal(job))
    return true
  }

  const contentId = jobIdFrom(customId, "mh_content:")
  if (interaction.isButton() && contentId) {
    const job = await getJob(contentId)
    if (!job || job.guildId !== guild.id) {
      await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await interaction.showModal(buildContentModal(job))
    return true
  }

  const embedEditId = jobIdFrom(customId, "mh_embed_edit:")
  if (interaction.isButton() && embedEditId) {
    const job = await getJob(embedEditId)
    if (!job || job.guildId !== guild.id) {
      await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await interaction.showModal(buildEmbedModal(job))
    return true
  }

  if (interaction.isStringSelectMenu() && customId === "mh_pick") {
    const id = interaction.values[0]
    const job = id ? await getJob(id) : null
    if (!job || job.guildId !== guild.id) {
      await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await refreshPanel(client, interaction, guild, job.id)
    return true
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.isFromMessage()) return false

    if (customId === "mh_modal_create") {
      const content = clampContent(interaction.fields.getTextInputValue("content"))
      const parsed = parseTime(interaction.fields.getTextInputValue("interval").trim())
      if (!content) {
        await interaction.reply({ content: "> *Indiquez un message.*", flags: MessageFlags.Ephemeral })
        return true
      }
      if (parsed === null || parsed <= 0) {
        await interaction.reply({
          content: "> *Durée invalide. Exemples : `1m`, `5m`, `1h`, `1d`.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const channel = await resolveCreateChannel(guild, interaction)
      if (!channel) {
        await interaction.reply({
          content: "> *Aucun salon valide. Configurez un salon par défaut ou utilisez la commande dans un salon textuel.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const result = await createJob({
        client,
        guildId: guild.id,
        channel,
        interval: clampInterval(parsed),
        content,
      })
      if (!result.ok) {
        await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
        return true
      }
      await refreshPanel(client, interaction, guild, null)
      await interaction
        .followUp({
          content: `> *Message horaire créé dans <#${result.job.channelId}> (\`${formatTime(result.job.interval)}\`).*`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined)
      return true
    }

    const modalIntervalId = jobIdFrom(customId, "mh_modal_interval:")
    if (modalIntervalId) {
      const parsed = parseTime(interaction.fields.getTextInputValue("interval").trim())
      if (parsed === null || parsed <= 0) {
        await interaction.reply({
          content: "> *Durée invalide. Exemples : `1m`, `5m`, `1h`, `1d`.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const job = await getJob(modalIntervalId)
      if (!job || job.guildId !== guild.id) {
        await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
        return true
      }
      const interval = clampInterval(parsed)
      const nextAt = job.enabled ? Date.now() + interval : job.nextAt
      await updateJob(job.id, { $set: { interval, nextAt } })
      await rescheduleJob(client, job.id)
      await refreshPanel(client, interaction, guild, job.id)
      return true
    }

    const modalContentId = jobIdFrom(customId, "mh_modal_content:")
    if (modalContentId) {
      const job = await getJob(modalContentId)
      if (!job || job.guildId !== guild.id) {
        await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
        return true
      }
      const content = clampContent(interaction.fields.getTextInputValue("content"))
      if (!hasSendablePayload({ content, embed: job.embed })) {
        await interaction.reply({
          content: "> *Le message et l'embed ne peuvent pas être tous les deux vides.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      await updateJob(job.id, { $set: { content } })
      await refreshPanel(client, interaction, guild, job.id)
      return true
    }

    const modalEmbedId = jobIdFrom(customId, "mh_modal_embed:")
    if (modalEmbedId) {
      const job = await getJob(modalEmbedId)
      if (!job || job.guildId !== guild.id) {
        await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
        return true
      }
      const title = clampTitle(interaction.fields.getTextInputValue("title"))
      const description = clampDescription(interaction.fields.getTextInputValue("description"))
      const colorRaw = interaction.fields.getTextInputValue("color").trim()
      const color = colorRaw ? parseOptionalColor(colorRaw) : null
      if (colorRaw && !color) {
        await interaction.reply({
          content: "> *Couleur invalide. Utilisez un hex `#RRGGBB`.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      const embed = {
        enabled: job.embed.enabled || Boolean(title || description),
        title,
        description,
        color,
      }
      if (!hasSendablePayload({ content: job.content, embed })) {
        await interaction.reply({
          content: "> *Le message et l'embed ne peuvent pas être tous les deux vides.*",
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
      await updateJob(job.id, { $set: { embed } })
      await refreshPanel(client, interaction, guild, job.id)
      return true
    }

    return false
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === "mh_channel_clear") {
    await updateConfig(guild.id, { $set: { defaultChannelId: null } })
    await refreshPanel(client, interaction, guild, null)
    return true
  }

  if (customId === "mh_channel" && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({ content: "> *Le salon doit être un salon textuel du serveur.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateConfig(guild.id, { $set: { defaultChannelId: channelId } })
    await refreshPanel(client, interaction, guild, null)
    return true
  }

  const toggleId = jobIdFrom(customId, "mh_toggle:")
  if (interaction.isButton() && toggleId) {
    const job = await getJob(toggleId)
    if (!job || job.guildId !== guild.id) {
      await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const result = await setJobEnabled(client, job.id, !job.enabled)
    if (!result.ok) {
      await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
      return true
    }
    await refreshPanel(client, interaction, guild, result.job.id)
    return true
  }

  const jobChannelId = jobIdFrom(customId, "mh_job_channel:")
  if (interaction.isChannelSelectMenu() && jobChannelId) {
    const channelId = interaction.values[0]
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({ content: "> *Le salon doit être un salon textuel du serveur.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const job = await getJob(jobChannelId)
    if (!job || job.guildId !== guild.id) {
      await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await updateJob(job.id, { $set: { channelId } })
    await refreshPanel(client, interaction, guild, job.id)
    return true
  }

  const embedToggleId = jobIdFrom(customId, "mh_embed_toggle:")
  if (interaction.isButton() && embedToggleId) {
    const job = await getJob(embedToggleId)
    if (!job || job.guildId !== guild.id) {
      await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const embed = { ...job.embed, enabled: !job.embed.enabled }
    if (!embed.enabled && !job.embed.title && !job.embed.description) {
      Object.assign(embed, defaultEmbed())
    }
    if (!hasSendablePayload({ content: job.content, embed })) {
      await interaction.reply({
        content: "> *Activez l'embed seulement après avoir défini un titre ou une description, ou laissez un message.*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    await updateJob(job.id, { $set: { embed } })
    await refreshPanel(client, interaction, guild, job.id)
    return true
  }

  const previewId = jobIdFrom(customId, "mh_preview:")
  if (interaction.isButton() && previewId) {
    const job = await getJob(previewId)
    if (!job || job.guildId !== guild.id) {
      await interaction.reply({ content: "> *Message horaire introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const payload = buildJobPayload(job)
    if (!payload) {
      await interaction.reply({
        content: "> *Rien à prévisualiser. Ajoutez un message ou un embed.*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
    return true
  }

  const deleteId = jobIdFrom(customId, "mh_delete:")
  if (interaction.isButton() && deleteId) {
    const result = await removeJob(deleteId)
    if (!result.ok) {
      await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
      return true
    }
    await refreshPanel(client, interaction, guild, null)
    return true
  }

  return false
}
