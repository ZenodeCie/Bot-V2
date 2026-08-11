import type { Client, Message } from "discord.js"
import { logCommandUse, replyError, requireGuild } from "../../utils/moderation/helpers.js"
import { ModerationConfig } from "../../utils/moderation/schema.js"

export default {
  name: "modlog",
  description: "Définit le salon de journalisation des actions de modération.",
  category: "moderation",
  aliases: ["setmodlog", "modlogs"],
  permissions: ["ManageGuild"],
  usage: "<#salon|off|status>",

  async execute(_client: Client, _message: Message, args: string[]) {
    logCommandUse("modlog", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const raw = args[0] ?? ""

    if (raw === "off" || raw === "disable") {
      await ModerationConfig.updateOne({ guildId: guild.id }, { $set: { logChannelId: null } }, { upsert: true })
      return _message.reply({
        embeds: [
          {
            title: " ",
            description: "# `📁` 〃 Logs de modération désactivés\n> *Aucune action de modération ne sera plus envoyée dans un salon de logs.*",
            color: 0x95a5a6,
          },
        ],
      })
    }

    const match = /^<#(\d{17,20})>$/.exec(raw.trim())
    const channel = match ? guild.channels.cache.get(match[1]) : null

    if (!channel) {
      const current = await ModerationConfig.findOne({ guildId: guild.id }).lean()
      if (current?.logChannelId) {
        return _message.reply({
          embeds: [
            {
              title: " ",
              description:
                `# \`📁\` 〃 Salon de logs\n` +
                `> ***Salon actuel :** <#${current.logChannelId}>*\n` +
                `> *Utilisez \`modlog <#salon>\` pour le changer ou \`modlog off\` pour le désactiver.*`,
              color: 0xf4e00b,
            },
          ],
        })
      }
      return replyError(
        _message,
        "400 Bad Request",
        "> *Salon invalide. Utilisez : `modlog <#salon>`, `modlog off` ou `modlog status`.*"
      )
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      return replyError(_message, "400 Bad Request", "> *Le salon de logs doit être un salon textuel du serveur.*")
    }

    await ModerationConfig.updateOne({ guildId: guild.id }, { $set: { logChannelId: channel.id } }, { upsert: true })

    return _message.reply({
      embeds: [
        {
          title: " ",
          description:
            `# \`📁\` 〃 Salon de logs configuré\n` +
            `> ***Salon :** <#${channel.id}>*\n` +
            `> *Toutes les actions de modération (réussies, refusées, échouées) y seront envoyées.*`,
          color: 0x2ecc71,
        },
      ],
    })
  },
}
