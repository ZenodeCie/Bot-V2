import type { Client, Message } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { handleJ2CInteraction, sendOwnerPanel } from "../../utils/join2create/dashboard.js"
import { J2CChannelRecords, mapRecord } from "../../utils/join2create/schema.js"

export default {
  name: "salon",
  description: "Réaffiche le panneau de contrôle de votre salon Join to Create.",
  category: "join2create",
  slashRegister: false,
  aliases: ["mon-salon", "j2c-panel"],
  permissions: [],
  usage: "",

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command salon used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const guild = message.guild
    void args
    const raw = await J2CChannelRecords.find({ guildId: guild.id, deletedAt: null })
      .lean()
      .catch(() => [])
    const mine = raw.find(
      (entry) =>
        entry.ownerId === message.author.id ||
        (Array.isArray(entry.coOwnerIds) && entry.coOwnerIds.includes(message.author.id))
    )
    if (!mine) {
      return message.reply({
        embeds: [
          buildErrorEmbed(
            "404 Not Found",
            "> *Vous n'avez aucun salon Join to Create actif sur ce serveur.*\n> *Rejoignez le **salon source** pour en créer un.*"
          ),
        ],
      })
    }

    const record = mapRecord(mine as unknown as Record<string, unknown>)
    await sendOwnerPanel(client, guild, record)
    return message.reply({ content: "> *Panneau réaffiché dans la discussion textuelle de votre salon vocal.*" })
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleJ2CInteraction(client, interaction)
  },
}