import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { publishPanel } from "../../utils/reactionroles/render.js"
import { requirePanel } from "./helpers.js"

export default {
  name: "republish",
  description: "Republier un panel : met à jour le message existant ou en envoie un nouveau.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "republish <panel>",
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
    const result = await publishPanel(client, client.reactionroles, panel)
    if (!result.ok) {
      await message.reply({ embeds: [buildModEmbed("cancel", "Publication impossible", result.error ?? "> *Erreur.*")] })
      return
    }
    const target = result.message
    if (!target) return
    const link = `https://discord.com/channels/${guild.id}/${target.channelId ?? panel.channelId}/${target.id}`
    await message.reply({
      embeds: [buildModEmbed("loop", "Panel republié", `> *Le panel **${panel.name || panel.id}** a été mis à jour : [voir le message](${link}).*`, "#57F287")],
    })
  },
}