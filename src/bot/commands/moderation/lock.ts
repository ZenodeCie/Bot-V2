import { ApplicationCommandOptionType, PermissionFlagsBits, type Client, type Message } from "discord.js"
import {
  extractReason,
  logCommandUse,
  replyError,
  requireGuild,
  resolveChannelIdFromArg,
} from "../../utils/moderation/helpers.js"
import { createCase, findActiveCase, logModCase } from "../../utils/moderation/cases.js"
import { appEmojiHeading } from "../../utils/appEmojis.js"

export interface OverwriteSnapshot {
  id: string
  type: number
  allow: string
  deny: string
}

const LOCK_DENY = {
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  AddReactions: false,
}

export default {
  name: "lock",
  description: "Verrouille un salon (l'état précédent des permissions est conservé pour le déverrouillage).",
  category: "moderation",
  aliases: ["verrouiller"],
  permissions: ["ManageChannels"],
  usage: "[#salon] <raison>",
  slash: [
    { name: "salon", description: "Salon à verrouiller", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: false },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("lock", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const channelId = resolveChannelIdFromArg(args[0] ?? "")
    const channel = channelId ? guild.channels.cache.get(channelId) : _message.channel

    if (!channel || channel.isDMBased() || !("permissionOverwrites" in channel)) {
      return replyError(_message, "400 Bad Request", "> *Salon invalide (les fils de discussion ne peuvent pas être verrouillés).*")
    }
    const reasonIndex = channelId ? 1 : 0
    const reason = extractReason(args, reasonIndex)

    const moderator = { id: _message.author.id, username: _message.author.username }

    const bot = await guild.members.fetchMe()
    if (!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels)) {
      return replyError(_message, "403 Forbidden", "> *Le bot ne possède pas la permission `Manage Channels` dans ce salon.*")
    }

    const activeLock = await findActiveCase(guild.id, "lock", undefined, channel.id)
    if (activeLock) {
      return replyError(
        _message,
        "409 Conflict",
        `> *Ce salon est déjà verrouillé (case **${activeLock.caseIdFormatted}**). Utilisez \`unlock\` avant.*`
      )
    }

    try {
      const snapshot: OverwriteSnapshot[] = channel.permissionOverwrites.cache.map((ow) => ({
        id: ow.id,
        type: ow.type,
        allow: String(ow.allow.bitfield),
        deny: String(ow.deny.bitfield),
      }))

      await channel.permissionOverwrites.edit(guild.roles.everyone.id, LOCK_DENY)

      const c = await createCase({
        guild,
        target: null,
        moderator,
        action: "LOCK",
        reason,
        channel: { id: channel.id, name: channel.name },
        metadata: { snapshot, locked: true },
      })
      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `${appEmojiHeading("power", "Salon verrouillé")}\n` +
              `> ***Salon :** <#${channel.id}>*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*\n` +
              `> *L'état précédent des permissions a été sauvegardé et sera restauré au \`unlock\`.*`,
            color: 0xf39c12,
          },
        ],
      })
    } catch (error) {
      console.error("Lock failed:", error)
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
