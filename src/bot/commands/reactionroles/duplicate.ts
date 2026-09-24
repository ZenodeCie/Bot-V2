import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { clonePanelWithFreshIds, requirePanel } from "./helpers.js"

export default {
  name: "duplicate",
  description: "Dupliquer un panel de rôles-réactions.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "duplicate <panel> [name]",
  slash: [
    {
      name: "panel",
      description: "Nom ou id du panel à dupliquer",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "name",
      description: "Nom du nouveau panel (défaut : copie de <panel>)",
      type: ApplicationCommandOptionType.String,
      required: false,
    },
  ],
  async execute(client: Client, message: Message, args: string[]) {
    const guild = requireGuild(message)
    if (!guild) return
    const panel = await requirePanel(client, message, args[0] ?? "")
    if (!panel) return
    const clone = clonePanelWithFreshIds(panel, args[1])
    await client.reactionroles.savePanel(clone)
    await message.reply({
      embeds: [buildModEmbed("loop", "Panel dupliqué", `> *Copie de **${panel.name || panel.id}** créée : **${clone.name || clone.id}**.*\n> *Publiez-la pour l'envoyer dans un salon.*`, "#57F287")],
    })
  },
}