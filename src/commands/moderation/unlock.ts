import { PermissionFlagsBits, type Client, type Message } from "discord.js"
import {
  extractReason,
  logCommandUse,
  replyError,
  requireGuild,
  resolveChannelIdFromArg,
} from "../../utils/moderation/helpers.js"
import { createCase, findActiveCase, logModCase } from "../../utils/moderation/cases.js"
import type { OverwriteSnapshot } from "./lock.js"

export default {
  name: "unlock",
  description: "Déverrouille un salon et restaure l'état précédent des permissions.",
  category: "moderation",
  aliases: ["deverrouiller"],
  permissions: ["ManageChannels"],
  usage: "[#salon] <raison>",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("unlock", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const channelId = resolveChannelIdFromArg(args[0] ?? "")
    const channel = channelId ? guild.channels.cache.get(channelId) : _message.channel

    if (!channel || channel.isDMBased() || !("permissionOverwrites" in channel)) {
      return replyError(_message, "400 Bad Request", "> *Salon invalide (les fils de discussion ne peuvent pas être déverrouillés).*")
    }
    const reasonIndex = channelId ? 1 : 0
    const reason = extractReason(args, reasonIndex)

    const moderator = { id: _message.author.id, username: _message.author.username }

    const bot = await guild.members.fetchMe()
    if (!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels)) {
      return replyError(_message, "403 Forbidden", "> *Le bot ne possède pas la permission `Manage Channels` dans ce salon.*")
    }

    const activeLock = await findActiveCase(guild.id, "lock", undefined, channel.id)
    if (!activeLock) {
      return replyError(_message, "400 Bad Request", "> *Ce salon n'est pas verrouillé.*")
    }

    try {
      const snapshot = activeLock.metadata.snapshot as OverwriteSnapshot[] | undefined
      let restored = 0
      if (Array.isArray(snapshot) && snapshot.length > 0) {
        await channel.permissionOverwrites.set(
          snapshot.map((item) => ({
            id: item.id,
            type: item.type,
            allow: BigInt(item.allow),
            deny: BigInt(item.deny),
          }))
        )
        restored = snapshot.length
      }

      const c = await createCase({
        guild,
        target: null,
        moderator,
        action: "UNLOCK",
        reason,
        linkedCaseId: activeLock.caseId,
        channel: { id: channel.id, name: channel.name },
        metadata: { restored, snapshotCount: Array.isArray(snapshot) ? snapshot.length : 0, lockCase: activeLock.caseIdFormatted },
      })
      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# \`🔓\` 〃 Salon déverrouillé\n` +
              `> ***Salon :** <#${channel.id}>*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Permissions restaurées :** ${restored}*\n` +
              `> ***Verrouillage d'origine :** ${activeLock.caseIdFormatted} (toujours consultable)*\n` +
              `> ***Case :** ${c.caseIdFormatted}*`,
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Unlock failed:", error)
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
