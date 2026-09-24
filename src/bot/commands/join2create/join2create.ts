import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { COMPONENTS_V2_FLAGS, buildJ2CContainer, handleJ2CInteraction } from "../../utils/join2create/dashboard.js"
import { getConfig } from "../../utils/join2create/schema.js"

export default {
  name: "join2create",
  description: "Configure le système Join to Create du serveur.",
  category: "join2create",
  slashRegister: false,
  aliases: ["j2c"],
  permissions: ["ManageGuild"],
  usage: "[config]",
  slash: [
    {
      name: "action",
      description: "config (affiche le panneau de configuration)",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [{ name: "config", value: "config" }],
    },
  ],

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command join2create used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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
      components: buildJ2CContainer(client, guild, config),
      flags: COMPONENTS_V2_FLAGS,
    })
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleJ2CInteraction(client, interaction)
  },
}