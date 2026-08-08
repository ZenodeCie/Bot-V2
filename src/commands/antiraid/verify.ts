import type { Client, Message } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"

export default {
  name: "verify",
  description: "Valide votre compte avec le code reçu en message privé.",
  category: "antiraid",
  aliases: ["vérif", "verif"],
  permissions: [],
  usage: "<code>",
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command verify used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }
    if (!args[0]) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `verify <code>`.*")],
      })
    }

    const member = message.member
    if (!member) return

    const ok = await client.antiraid.verifyMember(client, message.guild, member, args[0])
    if (!ok) {
      return message.reply({
        embeds: [
          buildErrorEmbed("400 Bad Request", "> *Code invalide, expiré ou aucune vérification en attente pour vous.*"),
        ],
      })
    }

    await message.reply({
      embeds: [buildAntiRaidEmbed("✅", "Vérification réussie", "> *Votre compte a été vérifié. Bienvenue sur le serveur !*")],
    })
    try {
      await message.delete()
    } catch {}
  },
}
