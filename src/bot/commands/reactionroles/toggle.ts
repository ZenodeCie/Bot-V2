import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { requirePanel } from "./helpers.js"

export default {
  name: "toggle",
  description: "Activer ou désactiver un panel de rôles-réactions.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "toggle <panel>",
  slash: [
    {
      name: "panel",
      description: "Nom ou id du panel",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
  async execute(client: Client, message: Message, args: string[]) {
    const guild = requireGuild(message)
    if (!guild) return
    const panel = await requirePanel(client, message, args[0] ?? "")
    if (!panel) return
    panel.enabled = !panel.enabled
    await client.reactionroles.savePanel(panel)
    await message.reply({
      embeds: [
        buildModEmbed(
          "power",
          panel.enabled ? "Panel activé" : "Panel désactivé",
          `> *Le panel **${panel.name || panel.id}** est maintenant ${panel.enabled ? "**activé**" : "*désactivé*"}.*`,
          "#57F287"
        ),
      ],
    })
  },
}