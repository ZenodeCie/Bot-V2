import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, MessageFlags, type ChatInputCommandInteraction } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildWhitelistContainer, handleWhitelistInteraction } from "../../utils/antiraid/dashboard.js"
import { AntiRaid, getConfig } from "../../utils/antiraid/schema.js"

const FIELDS: Record<string, string> = {
  user: "whitelistedUsers",
  role: "whitelistedRoles",
  bot: "whitelistedBots",
  channel: "whitelistedChannels",
}

export default {
  name: "whitelist",
  description: "Gère la liste blanche anti-raid.",
  category: "antiraid",
  aliases: ["wl", "liste-blanche"],
  permissions: ["Administrator"],
  usage: "[add|remove <user|role|bot|channel> <cible>|list]",
  slash: [
    {
      name: "action",
      description: "Action",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "add", value: "add" },
        { name: "remove", value: "remove" },
        { name: "list", value: "list" },
      ],
    },
    {
      name: "type",
      description: "Type de cible",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "user", value: "user" },
        { name: "role", value: "role" },
        { name: "bot", value: "bot" },
        { name: "channel", value: "channel" },
      ],
    },
    { name: "utilisateur", description: "Utilisateur ou bot", type: ApplicationCommandOptionType.User, required: false },
    { name: "role", description: "Rôle", type: ApplicationCommandOptionType.Role, required: false },
    { name: "salon", description: "Salon", type: ApplicationCommandOptionType.Channel, required: false },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action")
    if (!action) return []
    if (action === "list") return ["list"]
    const type = i.options.getString("type") ?? "user"
    const id = i.options.getUser("utilisateur")?.id ?? i.options.getRole("role")?.id ?? i.options.getChannel("salon")?.id ?? ""
    return [action, type, id]
  },
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command whitelist used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")] })
    }

    const action = args[0]?.toLowerCase()
    if (action === "add" || action === "remove") {
      const guildId = message.guild.id
      const type = args[1]?.toLowerCase()
      const target = args[2]

      if (!FIELDS[type ?? ""]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `whitelist <add|remove> <user|role|bot|channel> <cible>`.*")],
        })
      }

      let id: string | null = null
      if (type === "user" || type === "bot") id = message.mentions.users.first()?.id ?? target ?? null
      else if (type === "role") id = message.mentions.roles.first()?.id ?? target ?? null
      else id = message.mentions.channels.first()?.id ?? target ?? null

      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cible invalide : mentionnez-la ou fournissez un identifiant.*")] })
      }

      const field = FIELDS[type!]
      if (action === "add") {
        await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { [field]: id } }, { upsert: true })
      } else {
        await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { [field]: id } }, { upsert: true })
      }
      client.antiraid.invalidateConfig(guildId)

      const label = type === "user" ? "Utilisateur" : type === "role" ? "Rôle" : type === "bot" ? "Bot" : "Salon"
      const mention = type === "role" ? `<@&${id}>` : type === "channel" ? `<#${id}>` : `<@${id}>`
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "✅",
            "Liste blanche mise à jour",
            `> ***Type:** ${label}*\n> ***Cible:** ${mention}*\n> ***Action:** ${action === "add" ? "Ajouté" : "Retiré"}*`
          ),
        ],
      })
    }

    if (action === "list") {
      const config = await getConfig(message.guild.id)
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "🧍",
            "Liste blanche",
            `### \`👥\` Utilisateurs (${config.whitelistedUsers.length})\n` +
              (config.whitelistedUsers.length > 0
                ? `> ${config.whitelistedUsers.map((id) => `<@${id}>`).join(", ")}`
                : "> *Aucun*") +
              `\n\n### \`🎭\` Rôles (${config.whitelistedRoles.length})\n` +
              (config.whitelistedRoles.length > 0
                ? `> ${config.whitelistedRoles.map((id) => `<@&${id}>`).join(", ")}`
                : "> *Aucun*") +
              `\n\n### \`🤖\` Bots (${config.whitelistedBots.length})\n` +
              (config.whitelistedBots.length > 0
                ? `> ${config.whitelistedBots.map((id) => `<@${id}>`).join(", ")}`
                : "> *Aucun*") +
              `\n\n### \`📁\` Salons (${config.whitelistedChannels.length})\n` +
              (config.whitelistedChannels.length > 0
                ? `> ${config.whitelistedChannels.map((id) => `<#${id}>`).join(", ")}`
                : "> *Aucun*")
          ),
        ],
      })
    }

    const config = await getConfig(message.guild.id)
    return message.reply({ components: buildWhitelistContainer(client, message.guild as Guild, config), flags: MessageFlags.IsComponentsV2 })
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleWhitelistInteraction(client, interaction)
  },
}
