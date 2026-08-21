import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildTicketsPayload, handleTicketsInteraction } from "../../utils/tickets/dashboard.js"
import { COMPONENTS_V2_FLAGS, handleTicketActionInteraction } from "../../utils/tickets/engine.js"
import { getConfig } from "../../utils/tickets/schema.js"

export default {
  name: "ticket",
  description: "Configure le système de tickets du serveur.",
  category: "tickets",
  slashName: "config",
  aliases: ["tickets"],
  permissions: ["ManageGuild"],
  usage: "[panel]",
  slash: [
    {
      name: "action",
      description: "panel (affiche le panneau de configuration)",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [{ name: "panel", value: "panel" }],
    },
  ],

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command ticket used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const guild = message.guild
    void args
    const config = await getConfig(guild.id)
    return message.reply({
      components: buildTicketsPayload(client, guild, config),
      flags: COMPONENTS_V2_FLAGS,
    })
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    const handled = await handleTicketActionInteraction(client, interaction)
    if (handled) return true
    return handleTicketsInteraction(client, interaction)
  },
}
