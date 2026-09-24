import type { Client, Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { buildExportAttachment } from "../../utils/reactionroles/transfer.js"

export default {
  name: "export",
  description: "Exporter les panels de rôles-réactions du serveur en JSON.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "export",
  async execute(client: Client, message: Message) {
    const guild = requireGuild(message)
    if (!guild) return
    const attachment = await buildExportAttachment(client, guild)
    if (!attachment) {
      await message.reply({ embeds: [buildModEmbed("cancel", "Export impossible", "> *Aucun panel à exporter.*")] })
      return
    }
    await message.reply({
      embeds: [buildModEmbed("file", "Export réalisé", "> *Réimportez ce fichier sur un autre serveur avec `/rr import`. Les ids sont conservés si le serveur est le même.*", "#57F287")],
      files: [attachment],
    })
  },
}