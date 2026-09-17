import { EmbedBuilder, type GuildMember } from "discord.js"
import { colors } from "../../config.js"
import { padChannelNumber } from "./schema.js"

export interface J2CVariableContext {
  channelNumber: number | string
  memberName: string
  memberDisplayName: string
  memberUserId: string
  serverName: string
  guildMemberCount: number
}

export const J2C_VARIABLES: { key: string; example: string; description: string }[] = [
  { key: "{channelNumber}", example: "0001", description: "Numéro du salon (compteur du serveur)" },
  { key: "{memberName}", example: "rootatvyral", description: "Pseudo complet du membre" },
  { key: "{memberDisplayName}", example: "⎛⎝ ζ͜͡Vyral ⎠⎞", description: "Nom affiché du membre" },
  { key: "{memberUserId}", example: "1385340488894124235", description: "Identifiant du membre" },
  { key: "{serverName}", example: "Zenode", description: "Nom du serveur" },
  { key: "{guildMemberCount}", example: "2450", description: "Nombre de membres du serveur" },
]

export function interpolateJ2CVariables(text: string, ctx: J2CVariableContext): string {
  return text
    .replaceAll("{channelNumber}", typeof ctx.channelNumber === "string" ? ctx.channelNumber : padChannelNumber(ctx.channelNumber))
    .replaceAll("{memberName}", ctx.memberName)
    .replaceAll("{memberDisplayName}", ctx.memberDisplayName)
    .replaceAll("{memberUserId}", ctx.memberUserId)
    .replaceAll("{serverName}", ctx.serverName)
    .replaceAll("{guildMemberCount}", String(ctx.guildMemberCount))
}

export function contextFromMember(member: GuildMember, channelNumber: number): J2CVariableContext {
  return {
    channelNumber,
    memberName: member.user.username,
    memberDisplayName: member.displayName,
    memberUserId: member.id,
    serverName: member.guild.name,
    guildMemberCount: member.guild.memberCount,
  }
}

/** Sanitize a raw channel name (letters, digits, accents, spaces, '-', '_', "'", '*'). */
export function sanitizeChannelName(raw: string): string {
  const normalized = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}\s\-_'\u02BC*]/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[\s\-_]+|[\s\-_]+$/g, "")
  return normalized
}

export function buildChannelName(pattern: string, ctx: J2CVariableContext, max = 100): string {
  const interpolated = interpolateJ2CVariables(pattern, ctx)
  const cleaned = sanitizeChannelName(interpolated)
  return cleaned.slice(0, max) || `salon-${padChannelNumber(ctx.channelNumber)}`
}

export function buildJ2CVariablesEmbed(): EmbedBuilder {
  const lines = J2C_VARIABLES.map(
    (variable) => `> \`${variable.key}\` : \`${variable.example}\`\n> *${variable.description}*\n`
  ).join("\n")
  const embed = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(
      `# \`🎙️\` 〃 Variables — Join to Create\n` +
        `> *Variables utilisables dans le **nom du salon vocal**.*\n\n${lines}` +
        `\n-# Exemple de nom de salon : \`{channelNumber}-{memberDisplayName}\` → \`0001-Vyral\``
    )
  if (colors.prime) embed.setColor(colors.prime)
  return embed
}