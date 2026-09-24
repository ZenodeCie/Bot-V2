import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { publishPanel } from "../../utils/reactionroles/render.js"
import { requirePanel } from "./helpers.js"

export default {
  name: "publish",
  description: "Publier (ou mettre à jour) un panel de rôles-réactions dans son salon.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "publish <panel>",
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
    await message.reply({
      embeds: [
        buildModEmbed(
          "pin",
          "Panel publié",
          `> *Panel **${panel.name || panel.id}** publié : ${panel.channelId ? `<#${panel.channelId}>` : "salon inconnu"} — voir le [message](https://discord.com/channels/${guild.id}/${panel.channelId}/${result.message?.id ?? panel.messageId}).*`,
          "#57F287"
        ),
      ],
    })
  },
}