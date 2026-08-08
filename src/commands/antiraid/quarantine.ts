import type { Client, Guild, Message } from "discord.js"
import { MessageFlags } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildQuarantineContainer, handleQuarantineInteraction } from "../../utils/antiraid/dashboard.js"
import { colors } from "../../config.js"
import { getConfig } from "../../utils/antiraid/schema.js"

export default {
  name: "quarantine",
  description: "Gère la quarantaine (retrait de tous les rôles).",
  category: "antiraid",
  aliases: ["q", "quarantaine"],
  permissions: ["Administrator"],
  usage: "[add <@user>|remove <@user>|list|clear]",
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command quarantine used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")] })
    }

    const action = args[0]?.toLowerCase()

    if (action === "add") {
      const user = message.mentions.users.first()
      const id = user?.id ?? args[1]
      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un utilisateur : `quarantine add <@user>`.*")] })
      }
      const result = await client.antiraid.quarantineUser(client, message.guild, id)
      if (!result) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Impossible de placer cet utilisateur en quarantaine (rôle de quarantaine non configuré ou membre introuvable).*")],
        })
      }
      return message.reply({
        embeds: [buildAntiRaidEmbed("🛂", "Quarantaine", `> *<@${id}> a été placé en **quarantaine** (rôles retirés, permissions bloquées).*`, colors.orng)],
      })
    }

    if (action === "remove") {
      const user = message.mentions.users.first()
      const id = user?.id ?? args[1]
      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un utilisateur : `quarantine remove <@user>`.*")] })
      }
      await client.antiraid.unquarantineUser(client, message.guild, id)
      return message.reply({ embeds: [buildAntiRaidEmbed("🛂", "Quarantaine", `> *<@${id}> a été retiré de la quarantaine.*`)] })
    }

    if (action === "list") {
      const config = await getConfig(message.guild.id)
      const users = config.quarantine.users
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "🛂",
            "Quarantaine",
            users.length > 0
              ? `> ***Utilisateurs en quarantaine (${users.length}) :***\n` + users.map((id) => `> <@${id}>`).join("\n")
              : "> *Aucun utilisateur en quarantaine.*"
          ),
        ],
      })
    }

    if (action === "clear") {
      for (const id of (await getConfig(message.guild.id)).quarantine.users) {
        await client.antiraid.unquarantineUser(client, message.guild, id)
      }
      return message.reply({ embeds: [buildAntiRaidEmbed("🛂", "Quarantaine vidée", "> *Tous les utilisateurs ont été retirés de la quarantaine (rôles conservés).*")] })
    }

    const config = await getConfig(message.guild.id)
    return message.reply({ components: buildQuarantineContainer(client, message.guild as Guild, config), flags: MessageFlags.IsComponentsV2 })
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleQuarantineInteraction(client, interaction)
  },
}
