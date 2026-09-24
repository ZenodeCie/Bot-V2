import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { requirePanel } from "./helpers.js"

export default {
  name: "delete",
  description: "Supprimer un panel de rôles-réactions et ses attributions.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "delete <panel>",
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

    if (panel.channelId && panel.messageId) {
      const channel = await client.channels.fetch(panel.channelId).catch(() => null)
      if (channel && channel.isTextBased()) {
        await channel.messages.fetch(panel.messageId).then((item) => item.delete()).catch(() => undefined)
      }
    }

    await client.reactionroles.deletePanel(guild.id, panel.id)
    await message.reply({
      embeds: [buildModEmbed("cancel", "Panel supprimé", `> *Le panel **${panel.name || panel.id}** a été supprimé.*`, "#57F287")],
    })
  },
}