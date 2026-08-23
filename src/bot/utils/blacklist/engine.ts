import type { Client, GuildMember } from "discord.js"
import { punishMember } from "../antiraid/punish.js"
import { PUNISHMENT_LABELS } from "../antiraid/schema.js"
import { buildBlacklistEmbed, sendBlacklistLog } from "./logs.js"
import { getConfig, getEntry, type BlacklistEntryDoc } from "./schema.js"

export async function getBlockingEntry(guildId: string, userId: string): Promise<BlacklistEntryDoc | null> {
  return getEntry(guildId, userId)
}

export async function handleMemberJoin(client: Client, member: GuildMember): Promise<void> {
  const entry = await getEntry(member.guild.id, member.id)
  if (!entry) return

  const config = await getConfig(member.guild.id)
  if (!config.enabled || config.punishment === "none") {
    await sendBlacklistLog(
      client,
      member.guild.id,
      buildBlacklistEmbed(
        "people",
        "Membre blacklisté a rejoint",
        `> ***Utilisateur :** ${member.user.tag} (\`${member.id}\`)*\n` +
          `> ***Raison de la blacklist :** ${entry.reason}*\n` +
          `> ***Sanction automatique :** Désactivée*`
      )
    )
    return
  }

  const result = await punishMember(
    client,
    member,
    config.punishment,
    config.duration,
    `Blacklist du serveur : ${entry.reason}`
  )

  await sendBlacklistLog(
    client,
    member.guild.id,
    buildBlacklistEmbed(
      "cancel",
      "Membre blacklisté a rejoint",
      `> ***Utilisateur :** ${member.user.tag} (\`${member.id}\`)*\n` +
        `> ***Raison de la blacklist :** ${entry.reason}*\n` +
        `> ***Sanction appliquée :** ${result.applied ? PUNISHMENT_LABELS[config.punishment] : `Échec (${result.note ?? "raison inconnue"})`}*`
    )
  )
}
