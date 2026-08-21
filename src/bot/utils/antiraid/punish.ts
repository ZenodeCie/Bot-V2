import type { Client, Guild, GuildMember, User } from "discord.js"
import type { Punishment } from "./schema.js"
import { PUNISHMENT_LABELS } from "./schema.js"
import { buildUserEmbed } from "./logs.js"
import { colors } from "../../config.js"
import formatTime from "../formatTime.js"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function dmUser(user: User, title: string, desc: string): Promise<boolean> {
  try {
    await user.send({ embeds: [buildUserEmbed("cancel", title, desc, colors.red)] })
    return true
  } catch {
    return false
  }
}

export async function punishMember(
  client: Client,
  member: GuildMember,
  punishment: Punishment,
  duration: number,
  reason: string
): Promise<{ applied: boolean; label: string; note?: string }> {
  const label = PUNISHMENT_LABELS[punishment]
  const serverName = member.guild.name
  const desc = `> *Vous avez été sanctionné(e) sur **${serverName}**.*\n> ***Raison:** ${reason}*`

  switch (punishment) {
    case "warn":
      await dmUser(member.user, "Sanction", desc)
      return { applied: true, label, note: "Avertissement enregistré." }
    case "timeout":
      if (!member.moderatable) return { applied: false, label, note: "Le bot ne peut pas exclure temporairement ce membre." }
      await member.timeout(duration, reason)
      await dmUser(member.user, "Sanction", desc + `\n> ***Durée:** ${formatTime(duration)}*`)
      return { applied: true, label }
    case "kick":
      if (!member.kickable) return { applied: false, label, note: "Le bot ne peut pas expulser ce membre." }
      await member.kick(reason)
      await dmUser(member.user, "Sanction", desc)
      return { applied: true, label }
    case "ban":
      if (!member.bannable) return { applied: false, label, note: "Le bot ne peut pas bannir ce membre." }
      await member.ban({ reason })
      await dmUser(member.user, "Sanction", desc)
      return { applied: true, label }
    default:
      return { applied: false, label, note: "Aucune action appliquée." }
  }
}

export async function banUsers(client: Client, guild: Guild, users: User[], reason: string): Promise<number> {
  let count = 0
  for (const user of users) {
    try {
      await guild.members.ban(user, { reason })
      count++
    } catch (error) {
      console.error(`Failed to ban ${user.tag} in guild ${guild.id}:`, error)
    }
    await delay(400)
  }
  return count
}

export async function kickMembers(client: Client, guild: Guild, members: GuildMember[], reason: string): Promise<number> {
  let count = 0
  for (const member of members) {
    try {
      if (!member.kickable) continue
      await member.kick(reason)
      count++
    } catch (error) {
      console.error(`Failed to kick ${member.user.tag} in guild ${guild.id}:`, error)
    }
    await delay(400)
  }
  return count
}

export async function timeoutMembers(
  client: Client,
  guild: Guild,
  members: GuildMember[],
  duration: number,
  reason: string
): Promise<number> {
  let count = 0
  for (const member of members) {
    try {
      if (member.user.bot) continue
      if (!member.moderatable) continue
      await member.timeout(duration, reason)
      count++
    } catch (error) {
      console.error(`Failed to timeout ${member.user.tag} in guild ${guild.id}:`, error)
    }
    await delay(500)
  }
  return count
}
