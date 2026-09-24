import type { Client, MessageReaction, User } from "discord.js"
import { emojiKey } from "../../utils/reactionroles/schema.js"
import { resolveGuildMember } from "../../utils/reactionroles/engine.js"

export default {
  name: "messageReactionRemove",
  async execute(client: Client, reaction: MessageReaction, user: User) {
    if (user.bot) return
    try {
      if (reaction.partial) await reaction.fetch()
      if (reaction.message.partial) await reaction.message.fetch()
    } catch {
      return
    }
    if (reaction.message.author?.id !== client.user?.id) return
    const panel = client.reactionroles.panelForMessage(reaction.message.id)
    if (!panel) return
    const guild = reaction.message.guild
    if (!guild) return
    const member = await resolveGuildMember(guild, user.id)
    if (!member) return
    await client.reactionroles.applyReaction(
      guild,
      member,
      panel,
      emojiKey({ name: reaction.emoji.name ?? "", id: reaction.emoji.id ?? null, animated: reaction.emoji.animated ?? false }),
      false
    )
  },
}