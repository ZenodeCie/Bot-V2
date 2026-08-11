import { randomUUID } from "node:crypto"
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type Interaction,
  type Message,
} from "discord.js"
import formatTime from "../../utils/formatTime.js"
import parseTime from "../../utils/parseTime.js"
import {
  ACTION_PERMISSIONS,
  ACTION_REQUIRES_DURATION,
  CARD_ACTION_LABELS,
  CARD_ACTIONS,
  applyPunishment,
  validateCardDuration,
  type CardAction,
} from "../../utils/moderation/apply.js"
import { logModEvent, type CaseActor, type CaseTarget } from "../../utils/moderation/cases.js"
import { formatDate, logCommandUse, replyError, requireGuild, resolveTarget } from "../../utils/moderation/helpers.js"
import { getUserNote, setUserNote } from "../../utils/moderation/notes.js"
import { ACTION_EMOJIS, ACTION_LABELS, ModCase, STATUS_LABELS, type ModCaseDoc } from "../../utils/moderation/schema.js"

const PER_PAGE = 3

const CARD_COLOR = 0x2b2d31

const EMOJI = {
  cogUser: "<:CogUser:1469692167122325577>",
  people: "<:People:1469693090280505458>",
  eye: "<:Eye:1469692577384235161>",
  addUser: "<:AddUser:1469692085992034387>",
  notes: "<:Notes:1469692988870623369>",
  file: "<:File:1469692584959017070>",
  pen: "<:Pen:1469693057497563160>",
  check: "<:Check:1469692151251341425>",
  cancel: "<:Cancel:1469692099736895592>",
  pending: "<:Pending:1469693062543311044>",
  disable: "<:Disable:1469692191298556099>",
  bot: "<:Bot:1469692094342762526>",
  add: "<:Add:1469692082107977782>",
  leave: "<:Leave:1469692941068009686>",
  pause: "<:Pause:1469693044256145610>",
  gMute: "<:g_mute:1469685636217962549>",
  duration: "<:Duration:1469692196331458704>",
  loop: "<:Loop:1469692980586872957>",
} as const

const SELECT_EMOJIS: Record<CardAction, string> = {
  WARN: EMOJI.add,
  KICK: EMOJI.leave,
  BAN: EMOJI.cancel,
  TIMEOUT: EMOJI.pause,
  MUTE: EMOJI.gMute,
  TEMPBAN: EMOJI.duration,
  TEMPMUTE: EMOJI.loop,
}

const STATUS_LABELS_MAP: Record<string, string> = {
  online: "En ligne",
  idle: "Inactif",
  dnd: "Ne pas déranger",
  offline: "Hors ligne",
}

const STATUS_EMOJIS: Record<string, string> = {
  online: EMOJI.check,
  idle: EMOJI.pending,
  dnd: EMOJI.cancel,
  offline: EMOJI.disable,
}

interface PendingSanction {
  guildId: string
  targetId: string
  requesterId: string
  action: CardAction
  reason: string
  duration: number | null
}

interface CardRef {
  channelId: string
  messageId: string
  requesterId: string
}

const pendingSanctions = new Map<string, PendingSanction>()
const cardRefs = new Map<string, CardRef>()

function buildSanctionLines(cases: ModCaseDoc[]): string {
  return cases
    .map((c) => {
      const duration = c.duration ? ` • **Durée :** ${formatTime(c.duration)}` : ""
      return (
        `> **${c.caseIdFormatted}** — ${ACTION_EMOJIS[c.action]} **${ACTION_LABELS[c.action]}** — \`${STATUS_LABELS[c.status]}\`${duration}\n` +
        `> ***Raison :** ${c.reason}*\n` +
        `> ***Modérateur :** ${c.moderatorUsername} • ${formatDate(c.startedAt)} (<t:${Math.floor(c.startedAt / 1000)}:R>)*`
      )
    })
    .join("\n\n")
}

async function renderCard(
  client: Client,
  guildId: string,
  targetId: string,
  requesterId: string,
  page: number
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[]; totalPages: number }> {
  const guild: Guild | null = client.guilds.cache.get(guildId) ?? null
  const member = guild ? await guild.members.fetch(targetId).catch(() => null) : null
  const user = member?.user ?? (await client.users.fetch(targetId).catch(() => null))

  const note = await getUserNote(guildId, targetId)
  const all = await ModCase.find({ guildId, userId: targetId }).sort({ caseId: -1 }).lean()
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE))
  const safe = Math.min(page, totalPages - 1)
  const slice = all.slice(safe * PER_PAGE, (safe + 1) * PER_PAGE)

  const statusRaw = member?.presence?.status ?? "offline"
  const status = STATUS_LABELS_MAP[statusRaw] ?? "Hors ligne"
  const statusEmoji = STATUS_EMOJIS[statusRaw] ?? EMOJI.disable

  const joinedTs = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null
  const createdTs = user ? Math.floor(user.createdTimestamp / 1000) : null

  const description =
    `# ${EMOJI.cogUser} 〃 Fiche de <@${targetId}> ${user?.bot ? EMOJI.bot : ""}\n\n` +
    `**Pseudo** : <@${targetId}> (\`${targetId}\`)\n` +
    `**Surnom** : ${member?.nickname ?? "—"}\n` +
    `**Statut** : ${statusEmoji} ${status}\n` +
    `**Rôle principal** : ${member ? (member.roles.highest.id === member.guild.id ? "@everyone" : member.roles.highest.toString()) : "—"}\n\n` +
    `**Compte créé le** : ${createdTs ? `<t:${createdTs}:F> (<t:${createdTs}:R>)` : "—"}\n` +
    `**A rejoint le** : ${joinedTs ? `<t:${joinedTs}:F> (<t:${joinedTs}:R>)` : "—"}\n\n` +
    `## ${EMOJI.notes} 〃 Note interne\n` +
    `> ${note ? note.content : "*Aucune note définie.*"}\n` +
    (note
      ? `> *${EMOJI.pen} 〃 Écrite par **${note.authorName}** • Modifiée par **${note.lastEditorName}** (<t:${Math.floor(note.updatedAt / 1000)}:R>)*`
      : "") +
    `\n\n## ${EMOJI.file} 〃 Dernières sanctions (${slice.length}/${all.length})\n` +
    (slice.length ? buildSanctionLines(slice) : "> *Aucune sanction enregistrée.*") +
    `\n\n> ***Page :** ${safe + 1}/${totalPages}*`

  const embed = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(description)
    .setColor(CARD_COLOR)
    .setThumbnail(user?.displayAvatarURL() ?? null)
    .setFooter({ text: guild ? guild.name : "Fiche de modération" })

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`modcard_note_${guildId}_${targetId}_${requesterId}`)
      .setLabel("Note")
      .setEmoji(EMOJI.pen)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`modcard_nav_${guildId}_${targetId}_${requesterId}_${safe}_prev`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safe <= 0),
    new ButtonBuilder()
      .setCustomId(`modcard_nav_${guildId}_${targetId}_${requesterId}_${safe}_next`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safe >= totalPages - 1)
  )

  const select = new StringSelectMenuBuilder()
    .setCustomId(`modcard_punish_${guildId}_${targetId}_${requesterId}`)
    .setPlaceholder("Sanctionner l'utilisateur...")
    .addOptions(
      CARD_ACTIONS.map((action) => ({
        label: CARD_ACTION_LABELS[action],
        description: ACTION_REQUIRES_DURATION[action] ? "Nécessite une durée" : "Sans durée",
        emoji: SELECT_EMOJIS[action],
        value: action,
      }))
    )

  return {
    embeds: [embed],
    components: [row, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    totalPages,
  }
}

async function updateCardMessage(
  client: Client,
  guildId: string,
  targetId: string,
  requesterId: string,
  page: number
): Promise<boolean> {
  const ref = cardRefs.get(`${guildId}:${targetId}`)
  if (!ref) return false
  const channel = client.channels.cache.get(ref.channelId)
  if (!channel || !channel.isTextBased()) return false
  const message = await channel.messages.fetch(ref.messageId).catch(() => null)
  if (!message) return false
  const { embeds, components } = await renderCard(client, guildId, targetId, requesterId, page)
  await message.edit({ embeds, components })
  return true
}

function buildNoteModal(guildId: string, targetId: string, requesterId: string, current: string | null): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`modcard_note_modal_${guildId}_${targetId}_${requesterId}`)
    .setTitle("Note interne")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("Contenu de la note")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(1500)
          .setValue(current ?? "")
          .setPlaceholder("Rédigez une note interne sur cet utilisateur...")
      )
    )
}

function buildPunishModal(
  guildId: string,
  targetId: string,
  requesterId: string,
  action: CardAction
): ModalBuilder {
  const requires = ACTION_REQUIRES_DURATION[action]
  return new ModalBuilder()
    .setCustomId(`modcard_punish_modal_${guildId}_${targetId}_${requesterId}_${action}`)
    .setTitle(CARD_ACTION_LABELS[action])
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Raison")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(512)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel("Durée (ex : 10m, 1h, 7d)")
          .setStyle(TextInputStyle.Short)
          .setRequired(requires)
          .setPlaceholder(requires ? "Ex : 10m, 1h, 7d..." : "Non requis pour cette action")
      )
    )
}

export default {
  name: "modview",
  description: "Affiche la fiche de modération complète d'un utilisateur.",
  category: "moderation",
  aliases: ["fiche", "card", "mview", "modcard", "usercard"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur|id>",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("userinfo", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const resolved = await resolveTarget(client, guild, args[0] ?? "", false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target

    const { embeds, components } = await renderCard(client, guild.id, target.id, _message.author.id, 0)

    const sent = await _message.reply({ embeds, components })
    cardRefs.set(`${guild.id}:${target.id}`, {
      channelId: sent.channel.id,
      messageId: sent.id,
      requesterId: _message.author.id,
    })

    await logModEvent(
      client,
      guild.id,
      new EmbedBuilder()
        .setTitle(" ")
        .setDescription(
          `# \`${EMOJI.eye}\` 〃 Fiche de modération consultée\n` +
            `> ***Utilisateur :** ${target.username} (\`${target.id}\`)*\n` +
            `> ***Consultée par :** ${_message.author.username} (\`${_message.author.id}\`)*`
        )
        .setColor(CARD_COLOR)
    )
  },

  async handleInteraction(client: Client, interaction: Interaction): Promise<boolean> {
    if (!interaction.inGuild()) return false

    if (interaction.isButton()) {
      const noteMatch = /^modcard_note_(\d+)_(\d+)_(\d+)$/.exec(interaction.customId)
      if (noteMatch) {
        const [, guildId, targetId, requesterId] = noteMatch
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: "> *Cette interaction ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
          return true
        }
        const note = await getUserNote(guildId, targetId)
        await interaction.showModal(buildNoteModal(guildId, targetId, requesterId, note?.content ?? null))
        return true
      }

      const pendMatch = /^modcard_pend_([a-f0-9-]+)_(confirm|cancel)$/.exec(interaction.customId)
      if (pendMatch) {
        const dir = pendMatch[2] as "confirm" | "cancel"
        await handlePendingButton(client, interaction, pendMatch[1], dir)
        return true
      }

      const navMatch = /^modcard_nav_(\d+)_(\d+)_(\d+)_(\d+)_(prev|next)$/.exec(interaction.customId)
      if (navMatch) {
        const [, guildId, targetId, requesterId, pageStr, dir] = navMatch
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: "> *Cette interaction ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
          return true
        }
        const current = Number(pageStr)
        const requested = dir === "prev" ? Math.max(0, current - 1) : current + 1
        const { embeds, components } = await renderCard(client, guildId, targetId, requesterId, requested)
        await interaction.update({ embeds, components })
        return true
      }
    }

    if (interaction.isStringSelectMenu()) {
      const match = /^modcard_punish_(\d+)_(\d+)_(\d+)$/.exec(interaction.customId)
      if (match) {
        const [, guildId, targetId, requesterId] = match
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: "> *Cette interaction ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
          return true
        }
        const action = interaction.values[0] as CardAction
        if (!CARD_ACTIONS.includes(action)) return true
        if (!interaction.memberPermissions?.has(ACTION_PERMISSIONS[action])) {
          await interaction.reply({
            content: `> *Vous n'avez pas la permission nécessaire pour **${CARD_ACTION_LABELS[action]}**.*`,
            flags: MessageFlags.Ephemeral,
          })
          return true
        }
        await interaction.showModal(buildPunishModal(guildId, targetId, requesterId, action))
        return true
      }
    }

    if (interaction.isModalSubmit()) {
      const noteModalMatch = /^modcard_note_modal_(\d+)_(\d+)_(\d+)$/.exec(interaction.customId)
      if (noteModalMatch) {
        const [, guildId, targetId, requesterId] = noteModalMatch
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: "> *Cette interaction ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
          return true
        }
        const content = interaction.fields.getTextInputValue("note").trim()
        const note = await setUserNote(guildId, targetId, content, interaction.user.id, interaction.user.username)
        await logModEvent(
          client,
          guildId,
          new EmbedBuilder()
            .setTitle(" ")
            .setDescription(
              `# \`${EMOJI.notes}\` 〃 Note de modération ${note.createdAt === note.updatedAt ? "ajoutée" : "modifiée"}\n` +
                `> ***Utilisateur :** <@${targetId}> (\`${targetId}\`)*\n` +
                `> ***Auteur :** ${note.authorName} (\`${note.authorId}\`)*\n` +
                `> ***Contenu :** ${content}*`
            )
            .setColor(CARD_COLOR)
        )
        await updateCardMessage(client, guildId, targetId, requesterId, 0).catch(() => undefined)
        await interaction.reply({
          embeds: [
            {
              title: " ",
              description:
                `# \`${EMOJI.check}\` 〃 Note enregistrée\n` +
                `> *La note interne de <@${targetId}> a été ${note.createdAt === note.updatedAt ? "ajoutée" : "mise à jour"}.*`,
              color: CARD_COLOR,
            },
          ],
          flags: MessageFlags.Ephemeral,
        })
        return true
      }

      const punishModalMatch = /^modcard_punish_modal_(\d+)_(\d+)_(\d+)_(\w+)$/.exec(interaction.customId)
      if (punishModalMatch) {
        const [, guildId, targetId, requesterId, actionStr] = punishModalMatch
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: "> *Cette interaction ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
          return true
        }
        const action = actionStr as CardAction
        if (!CARD_ACTIONS.includes(action)) return true

        const reason = interaction.fields.getTextInputValue("reason").trim()
        if (!reason) {
          await interaction.reply({ content: "> *La raison est obligatoire.*", flags: MessageFlags.Ephemeral })
          return true
        }

        let duration: number | null = null
        if (ACTION_REQUIRES_DURATION[action]) {
          const raw = interaction.fields.getTextInputValue("duration").trim()
          duration = parseTime(raw)
          if (duration === null) {
            await interaction.reply({
              content: "> *Durée invalide. Exemples : `10m`, `1h`, `7d`.*",
              flags: MessageFlags.Ephemeral,
            })
            return true
          }
          const limitError = validateCardDuration(action, duration)
          if (limitError) {
            await interaction.reply({ content: `> *${limitError}*`, flags: MessageFlags.Ephemeral })
            return true
          }
        }

        if (!interaction.memberPermissions?.has(ACTION_PERMISSIONS[action])) {
          await interaction.reply({
            content: `> *Vous n'avez pas la permission nécessaire pour **${CARD_ACTION_LABELS[action]}**.*`,
            flags: MessageFlags.Ephemeral,
          })
          return true
        }

        const token = randomUUID()
        pendingSanctions.set(token, { guildId, targetId, requesterId, action, reason, duration })
        setTimeout(() => pendingSanctions.delete(token), 5 * 60_000).unref()

        const confirmationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`modcard_pend_${token}_confirm`)
            .setLabel("Confirmer")
            .setEmoji(EMOJI.check)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`modcard_pend_${token}_cancel`)
            .setLabel("Annuler")
            .setEmoji(EMOJI.cancel)
            .setStyle(ButtonStyle.Secondary)
        )

        await interaction.reply({
          embeds: [
            {
              title: " ",
              description:
                `# \`${EMOJI.pending}\` 〃 Confirmation de sanction\n` +
                `> ***Action :** ${CARD_ACTION_LABELS[action]}*\n` +
                `> ***Utilisateur :** <@${targetId}>*\n` +
                `> ***Raison :** ${reason}*\n` +
                `> ***Durée :** ${duration ? formatTime(duration) : "Permanente"}*\n` +
                `> *Cliquez sur **Confirmer** pour appliquer la sanction.*`,
              color: CARD_COLOR,
            },
          ],
          components: [confirmationRow],
          flags: MessageFlags.Ephemeral,
        })
        return true
      }
    }

    return false
  },
}

async function handlePendingButton(
  client: Client,
  interaction: import("discord.js").ButtonInteraction,
  token: string,
  dir: "confirm" | "cancel"
): Promise<void> {
  const pending = pendingSanctions.get(token)
  if (!pending) {
    await interaction.reply({ content: "> *Cette demande a expiré. Lancez à nouveau la sanction.*", flags: MessageFlags.Ephemeral })
    return
  }
  if (interaction.user.id !== pending.requesterId) {
    await interaction.reply({ content: "> *Cette interaction ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
    return
  }

  await interaction.deferUpdate()

  if (dir === "cancel") {
    pendingSanctions.delete(token)
    await interaction.editReply({
      embeds: [
        {
          title: " ",
          description: `# \`${EMOJI.cancel}\` 〃 Sanction annulée\n> *Aucune modification n'a été appliquée.*`,
          color: CARD_COLOR,
        },
      ],
      components: [],
    })
    return
  }

  const guild = client.guilds.cache.get(pending.guildId)
  if (!guild) {
    pendingSanctions.delete(token)
    await interaction.editReply({
      embeds: [
        {
          title: " ",
          description: "# \`❌\` 〃 Erreur\n> *Serveur introuvable.*",
          color: 0xe82c20,
        },
      ],
      components: [],
    })
    return
  }

  const user = await client.users.fetch(pending.targetId).catch(() => null)
  const target: CaseTarget = {
    id: pending.targetId,
    username: user?.username ?? "Utilisateur inconnu",
    globalName: user?.globalName ?? null,
  }
  const moderator: CaseActor = { id: pending.requesterId, username: interaction.user.username }

  const result = await applyPunishment(client, guild, target, moderator, pending.action, pending.reason, pending.duration)

  if (!result.ok) {
    await interaction.editReply({
      embeds: [
        {
          title: " ",
          description:
            `# \`${EMOJI.cancel}\` 〃 Sanction refusée\n` +
            `> ***Action :** ${CARD_ACTION_LABELS[pending.action]}*\n` +
            `> ***Utilisateur :** <@${pending.targetId}>*\n` +
            `> *${result.error}*`,
          color: 0xe82c20,
        },
      ],
      components: [],
    })
  } else {
    const c = result.result.caseDoc
    await interaction.editReply({
      embeds: [
        {
          title: " ",
          description:
            `# \`${EMOJI.check}\` 〃 ${CARD_ACTION_LABELS[pending.action]} effectuée\n` +
            `> ***Utilisateur :** <@${pending.targetId}> (\`${pending.targetId}\`)*\n` +
            `> ***Raison :** ${pending.reason}*\n` +
            (pending.duration ? `> ***Durée :** ${formatTime(pending.duration)}*\n` : "") +
            `> ***Case :** ${c.caseIdFormatted}*` +
            (result.result.dm.status === "failed" ? `\n> *⚠️ DM impossible à envoyer : ${result.result.dm.error}*` : ""),
          color: CARD_COLOR,
        },
      ],
      components: [],
    })
    await updateCardMessage(client, pending.guildId, pending.targetId, pending.requesterId, 0).catch(() => undefined)
  }

  pendingSanctions.delete(token)
}
