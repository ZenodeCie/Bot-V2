import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

const TICKET_VARIABLES: { key: string; example: string; description: string }[] = [
  { key: "{ticketNumber}", example: "0000", description: "Numéro du ticket (compteur du serveur)" },
  { key: "{memberTag}", example: "rootatvyral", description: "Pseudo complet du membre" },
  { key: "{memberDisplayName}", example: "⎛⎝ ζ͜͡Vyral ⎠⎞", description: "Nom affiché du membre" },
  { key: "{memberUserId}", example: "1385340488894124235", description: "Identifiant du membre" },
]

function buildVariablesEmbed(scope: string): EmbedBuilder {
  const lines =
    scope === "ticket"
      ? TICKET_VARIABLES.map(
          (variable) => `> \`${variable.key}\` : \`${variable.example}\`\n> *${variable.description}*\n`
        ).join("\n")
      : ""
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

export default {
  name: "variables",
  description: "Affiche les variables disponibles pour les modules.",
  category: "tickets",
  aliases: ["variable", "vars"],
  permissions: ["ManageGuild"],
  usage: "[ticket]",
  slash: [
    {
      name: "var",
      description: "Module concerné (ex : ticket)",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [{ name: "ticket", value: "ticket" }],
    },
  ],

  async execute(_client: Client, message: Message, args: string[]) {
    console.log(
      `Command variables used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    const raw = stripAccents((args[0] ?? "ticket").toLowerCase())
    if (!["ticket", "tickets", "tk"].includes(raw)) {
      return message.reply({
        embeds: [
          buildErrorEmbed(
            "404 Not Found",
            "> *Groupe de variables inconnu. Groupes disponibles : `ticket`.*\n> *Exemple : `variables ticket`.*"
          ),
        ],
      })
    }

    return message.reply({ embeds: [buildVariablesEmbed("ticket")] })
  },

  slashArgs: (interaction: ChatInputCommandInteraction) => {
    const args: string[] = []
    const value = interaction.options.getString("var")
    if (value) args.push(value)
    return args
  },
}
