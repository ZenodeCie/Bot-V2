import { ApplicationCommandOptionType, type ChatInputCommandInteraction, type Client, type Message } from "discord.js"
import { buildModEmbed, replyError, requireGuild } from "../../utils/moderation/helpers.js"
import { importPanelsFromText } from "../../utils/reactionroles/transfer.js"

export default {
  name: "import",
  description: "Importer des panels de rôles-réactions depuis un fichier /rr export.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "import <fichier>",
  slash: [
    {
      name: "file",
      description: "Fichier JSON exporté (/rr export)",
      type: ApplicationCommandOptionType.Attachment,
      required: true,
    },
  ],
  slashArgs: (interaction: ChatInputCommandInteraction) => [interaction.options.getAttachment("file")?.url ?? ""],
  async execute(client: Client, message: Message, args: string[]) {
    const guild = requireGuild(message)
    if (!guild) return
    const url = (args[0] ?? "").trim()
    if (!url) {
      await message.reply({
        embeds: [buildModEmbed("cancel", "Fichier requis", "> *Joignez un fichier JSON exporté par `/rr export`.*")],
      })
      return
    }

    let text: string
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      text = await response.text()
    } catch {
      await replyError(message, "400 Bad Request", "> *Impossible de télécharger le fichier fourni.*")
      return
    }

    const result = await importPanelsFromText(client, guild, text)
    if (!result.ok) {
      await replyError(message, "400 Bad Request", result.error ?? "> *Import impossible.*")
      return
    }

    await message.reply({
      embeds: [
        buildModEmbed(
          "file",
          "Import réalisé",
          `> *${result.imported} panel${result.imported > 1 ? "aux" : ""} importé${result.imported > 1 ? "s" : ""}.\n> *Publiez chaque panel pour l'envoyer dans son salon (voir /rr publish).*`,
          "#57F287"
        ),
      ],
    })
  },
}