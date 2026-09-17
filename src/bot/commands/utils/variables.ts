import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildTicketVariablesEmbed } from "../../utils/tickets/variableData.js"
import { buildJ2CVariablesEmbed } from "../../utils/join2create/variables.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

interface VariableGroup {
  key: string
  module: string
  label: string
  build: () => EmbedBuilder
}

const VARIABLE_GROUPS: VariableGroup[] = [
  { key: "ticket", module: "Tickets", label: "ticket", build: buildTicketVariablesEmbed },
  { key: "join2create", module: "JoinToCreate", label: "join2create", build: buildJ2CVariablesEmbed },
]

function resolveGroup(raw: string): VariableGroup | null {
  const normalized = stripAccents(raw.toLowerCase()).replace(/\s+/g, "")
  return VARIABLE_GROUPS.find((group) => group.key === normalized || group.label === normalized) ?? null
}

export default {
  name: "variables",
  description: "Affiche les variables disponibles pour les modules.",
  category: "utils",
  aliases: ["variable", "vars"],
  permissions: ["ManageGuild"],
  usage: "[ticket|join2create]",
  slash: [
    {
      name: "var",
      description: "Module concerné (ex : ticket)",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "ticket", value: "ticket" },
        { name: "join2create", value: "join2create" },
      ],
    },
  ],

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command variables used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    const requested = args[0] ?? "ticket"
    const group = resolveGroup(requested)
    if (!group) {
      return message.reply({
        embeds: [
          buildErrorEmbed(
            "404 Not Found",
            "> *Groupe de variables inconnu. Groupes disponibles : `ticket` et `join2create`.*\n> *Exemple : `variables ticket`.*"
          ),
        ],
      })
    }

    if (!client.enabledModules.has(group.module)) {
      return message.reply({
        embeds: [
          buildErrorEmbed(
            "400 Bad Request",
            `> *Le module **${group.label}** n'est pas activé sur ce serveur.*\n> *Seuls les modules actifs disposent de variables.*`
          ),
        ],
      })
    }

    return message.reply({ embeds: [group.build()] })
  },

  slashArgs: (interaction: ChatInputCommandInteraction) => {
    const args: string[] = []
    const value = interaction.options.getString("var")
    if (value) args.push(value)
    return args
  },
}