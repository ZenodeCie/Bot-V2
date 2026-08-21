import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, MessageFlags } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildLogsContainer, handleLogsInteraction } from "../../utils/antiraid/dashboard.js"
import { getConfig } from "../../utils/antiraid/schema.js"

export default {
  name: "arlogs",
  description: "Affiche le journal de sécurité anti-raid.",
  category: "antiraid",
  aliases: ["log", "journal"],
  slashName: "logs",
  permissions: ["Administrator"],
  usage: "[filtre]",
  slash: [
    { name: "filtre", description: "Filtre du journal", type: ApplicationCommandOptionType.String, required: false },
  ],
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command arlogs used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({ embeds: [buildErrorEmbed("Erreur", "> *Cette commande doit être exécutée dans un serveur.*")] })
    }

    const filter = args[0]?.toLowerCase()
    if (filter) {
      const events = client.antiraid.getEventLog(message.guild.id)
      const filtered = events.filter((e) => e.type === filter)
      const slice = filtered.slice(-10)
      const lines =
        slice.length > 0
          ? slice.map((e) => `> \`<t:${Math.floor(e.ts / 1000)}:R>\` \`${e.type}\` — ${e.detail ?? "..."}`).join("\n")
          : "> *Aucun événement enregistré.*"
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "file",
            `Journal de sécurité (filtre : \`${filter}\`)`,
            lines + `\n\n> ***Total des événements enregistrés :** ${filtered.length}*`
          ),
        ],
      })
    }

    const config = await getConfig(message.guild.id)
    return message.reply({ components: buildLogsContainer(client, message.guild as Guild, config), flags: MessageFlags.IsComponentsV2 })
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleLogsInteraction(client, interaction)
  },
}
