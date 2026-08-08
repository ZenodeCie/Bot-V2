import type { Client, Guild, Message } from "discord.js"
import { MessageFlags } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildPanicContainer, handlePanicInteraction } from "../../utils/antiraid/dashboard.js"
import { colors } from "../../config.js"
import { getConfig } from "../../utils/antiraid/schema.js"

export default {
  name: "panic",
  description: "Déclenche ou restaure le mode urgence critique (panic).",
  category: "antiraid",
  aliases: ["panik"],
  permissions: ["Administrator"],
  usage: "[on|off]",
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command panic used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")] })
    }

    const action = args[0]?.toLowerCase()
    if (action === "off" || action === "disable") {
      const config = await getConfig(message.guild.id)
      await client.antiraid.deactivatePanic(client, config)
      return message.reply({
        embeds: [buildAntiRaidEmbed("♻️", "Panic désactivé", "> *L'état précédent du serveur a été restauré.*")],
      })
    }

    if (action === "on" || action === "enable" || !action) {
      const config = await getConfig(message.guild.id)
      await client.antiraid.activatePanic(client, config)
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "💣",
            "MODE PANIC ACTIF",
            "> *Le serveur est en **urgence critique** : lockdown activé, arrivées bloquées, salons gelés, logs CRITICAL.*",
            colors.red
          ),
        ],
      })
    }

    return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `panic` ou `panic off`.*")] })
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handlePanicInteraction(client, interaction)
  },
}
