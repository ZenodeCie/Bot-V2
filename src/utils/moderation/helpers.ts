import { EmbedBuilder, type Client, type Guild, type GuildMember, type Message } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../errorEmbed.js"

export function logCommandUse(name: string, message: Message): void {
  console.log(
    `Command ${name} used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
  )
}

export function requireGuild(message: Message): Guild | null {
  if (message.guild) return message.guild
  void message.reply({
    embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
  })
  return null
}

export function replyError(message: Message, title: string, desc: string) {
  return message.reply({ embeds: [buildErrorEmbed(title, desc)] })
}

export function buildModEmbed(
  emoji: string,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.red
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(" ").setDescription(`# \`${emoji}\` 〃 ${title}\n${desc}`)
  if (color) embed.setColor(color)
  return embed
}

export function resolveIdFromArg(arg: string): string | null {
  const trimmed = arg.trim()
  const mention = /^<@!?(\d{17,20})>$/.exec(trimmed)
  if (mention) return mention[1]
  if (/^\d{17,20}$/.test(trimmed)) return trimmed
  return null
}

export function resolveChannelIdFromArg(arg: string): string | null {
  const trimmed = arg.trim()
  const mention = /^<#(\d{17,20})>$/.exec(trimmed)
  if (mention) return mention[1]
  if (/^\d{17,20}$/.test(trimmed)) return trimmed
  return null
}

export function extractReason(args: string[], fromIndex: number): string {
  const reason = args.slice(fromIndex).join(" ").trim()
  return reason || "Aucune raison fournie"
}

export function parseDeleteDays(args: string[]): number {
  for (const arg of args) {
    const match = /^d:([0-7])$/.exec(arg.toLowerCase())
    if (match) return Number(match[1])
  }
  return 0
}

export function formatDate(ts: number): string {
  const date = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function parseCaseIdArg(arg: string): number | null {
  const cleaned = arg.trim().replace(/^case[-_: ]?/i, "").replace(/^#/, "")
  const num = Number(cleaned)
  return Number.isInteger(num) && num > 0 ? num : null
}

export function parseWarningIdArg(arg: string): number | null {
  const cleaned = arg.trim().replace(/^warn[-_: ]?/i, "").replace(/^#/, "")
  const num = Number(cleaned)
  return Number.isInteger(num) && num > 0 ? num : null
}

export function checkModerationTarget(moderator: GuildMember, target: GuildMember, bot: GuildMember): string | null {
  if (target.id === bot.id) return "Impossible de modérer le bot."
  if (target.id === moderator.id) return "Vous ne pouvez pas vous modérer vous-même."
  if (target.id === target.guild.ownerId) return "Impossible de modérer le propriétaire du serveur."
  if (moderator.roles.highest.position <= target.roles.highest.position)
    return "Votre rôle n'est pas assez élevé pour modérer cet utilisateur (hiérarchie des rôles)."
  if (bot.roles.highest.position <= target.roles.highest.position)
    return "Le rôle du bot n'est pas assez élevé pour modérer cet utilisateur (hiérarchie des rôles)."
  return null
}

export interface ResolvedTarget {
  id: string
  username: string
  globalName: string | null
  member: GuildMember | null
}

export async function resolveTarget(
  client: Client,
  guild: Guild,
  arg: string,
  requireMember = true
): Promise<{ ok: true; target: ResolvedTarget } | { ok: false; error: string }> {
  const id = resolveIdFromArg(arg)
  if (!id) return { ok: false, error: "Utilisateur invalide. Utilisez une mention (@utilisateur) ou un ID." }
  let member: GuildMember | null = null
  try {
    member = await guild.members.fetch(id)
  } catch {
    member = null
  }
  if (!member) {
    if (requireMember) return { ok: false, error: "Utilisateur introuvable dans ce serveur." }
    try {
      const user = await client.users.fetch(id)
      return { ok: true, target: { id, username: user.username, globalName: user.globalName ?? null, member: null } }
    } catch {
      return { ok: true, target: { id, username: "Utilisateur inconnu", globalName: null, member: null } }
    }
  }
  return { ok: true, target: { id, username: member.user.username, globalName: member.user.globalName ?? null, member } }
}
