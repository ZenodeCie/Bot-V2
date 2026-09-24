import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { configReplyPayload } from "../../utils/configHub/components.js"
import { buildReactionRolesEditor } from "../../utils/reactionroles/dashboard.js"
import { requireGuild } from "../../utils/moderation/helpers.js"
import { requirePanel } from "./helpers.js"

export default {
  name: "edit",
  description: "Ouvrir l'éditeur d'un panel de rôles-réactions.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "edit <panel>",
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
    const containers = await buildReactionRolesEditor(client, guild, panel)
    await message.reply(configReplyPayload(containers))
  },
}