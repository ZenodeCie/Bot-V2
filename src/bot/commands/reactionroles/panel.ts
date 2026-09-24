import type { Client, Message } from "discord.js"
import { configReplyPayload } from "../../utils/configHub/components.js"
import { buildReactionRolesHome, handleReactionRolesInteraction } from "../../utils/reactionroles/dashboard.js"
import { handleMemberInteraction } from "../../utils/reactionroles/member.js"
import { requireGuild } from "../../utils/moderation/helpers.js"

export default {
  name: "panel",
  description: "Ouvrir la configuration des rôles-réactions.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "panel",
  async execute(client: Client, message: Message) {
    const guild = requireGuild(message)
    if (!guild) return
    const containers = await buildReactionRolesHome(client, guild)
    await message.reply(configReplyPayload(containers))
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    if (await handleMemberInteraction(client, interaction)) return true
    return handleReactionRolesInteraction(client, interaction)
  },
}