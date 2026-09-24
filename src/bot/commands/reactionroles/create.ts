import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { defaultPanel, isPanelLanguage, isPanelMode } from "../../utils/reactionroles/schema.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { panelContext } from "./helpers.js"

export default {
  name: "create",
  description: "Créer un panel de rôles-réactions.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "create <nom> [mode] [langue]",
  slash: [
    {
      name: "name",
      description: "Nom du panel",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "mode",
      description: "Mode de comportement",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "Normal (toggle)", value: "normal" },
        { name: "Unique (un seul rôle)", value: "unique" },
        { name: "Vérification (ajout seul)", value: "verify" },
        { name: "Drop (retrait)", value: "drop" },
        { name: "Inversé (réaction = retrait)", value: "reversed" },
      ],
    },
    {
      name: "language",
      description: "Langue par défaut (fr / en)",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "Français", value: "fr" },
        { name: "English", value: "en" },
      ],
    },
  ],
  async execute(client: Client, message: Message, args: string[]) {
    const guild = requireGuild(message)
    if (!guild) return
    const name = (args[0] ?? "").trim()
    if (!name) {
      await message.reply({
        embeds: [buildModEmbed("cancel", "Nom requis", "> *Indiquez un nom pour le panel.*")],
      })
      return
    }
    const mode = args[1] && isPanelMode(args[1]) ? args[1] : "normal"
    const language = args[2] && isPanelLanguage(args[2]) ? args[2] : "fr"
    const panel = defaultPanel(guild.id, language)
    panel.name = name.slice(0, 60)
    panel.mode = mode
    await client.reactionroles.savePanel(panel)
    await message.reply({
      embeds: [buildModEmbed("add", "Panel créé", panelContext(panel), "#57F287")],
    })
  },
}