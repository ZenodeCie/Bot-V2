import { EmbedBuilder } from "discord.js"
import { colors } from "../../config.js"

export const TICKET_VARIABLES: { key: string; example: string; description: string }[] = [
  { key: "{ticketNumber}", example: "0000", description: "Numéro du ticket (compteur du serveur)" },
  { key: "{memberTag}", example: "rootatvyral", description: "Pseudo complet du membre" },
  { key: "{memberDisplayName}", example: "⎛⎝ ζ͜͡Vyral ⎠⎞", description: "Nom affiché du membre" },
  { key: "{memberUserId}", example: "1385340488894124235", description: "Identifiant du membre" },
]

export function buildTicketVariablesEmbed(): EmbedBuilder {
  const lines = TICKET_VARIABLES.map(
    (variable) => `> \`${variable.key}\` : \`${variable.example}\`\n> *${variable.description}*\n`
  ).join("\n")
  const embed = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(
      `# \`🎫\` 〃 Variables — Tickets\n` +
        `> *Variables utilisables dans le **nom du salon**, le **texte d'ouverture** et l'embed d'envoi.*\n\n${lines}` +
        `\n-# Exemple de nom de salon : \`{ticketNumber}-{memberDisplayName}\` → \`0001-Vyral\``
    )
  if (colors.prime) embed.setColor(colors.prime)
  return embed
}