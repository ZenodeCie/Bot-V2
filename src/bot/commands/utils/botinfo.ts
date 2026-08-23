import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  version as djsVersion,
  type Client,
  type Interaction,
  type Message,
} from "discord.js"
import { cpus, loadavg } from "node:os"
import config, { botRuntime, colors } from "../../config.js"
import { resolveSupportUrl } from "../../../shared/botConfig.js"
import { appEmojiText } from "../../utils/appEmojis.js"
import { Giveaway } from "../../utils/giveaway/schema.js"
import { LevelUser } from "../../utils/levels/schema.js"
import { TicketRecords } from "../../utils/tickets/schema.js"
import formatTime from "../../utils/formatTime.js"

const TOP3_BUTTON_ID = "botinfo-top3"

function formatNumber(value: number): string {
  return value.toLocaleString("fr-FR")
}

function pingLabel(ms: number): string {
  if (ms < 100) return "Bonne"
  if (ms < 200) return "Moyenne"
  return "Élevée"
}

function formatRam(): string {
  return `${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} Mo`
}

function formatCpu(): string {
  const cores = cpus().length || 1
  const load = loadavg()[0] ?? 0
  const pct = Math.min(100, (load / cores) * 100)
  return `${pct.toFixed(1)}%`
}

function inviteUrl(clientId: string): string {
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`
}

function sectionSeparator(): string {
  return "\n-# ─────────────────\n"
}

interface GeneralStats {
  openTickets: number | null
  activeGiveaways: number | null
  totalXp: number | null
  topUserId: string | null
}

async function fetchGeneralStats(client: Client): Promise<GeneralStats> {
  const stats: GeneralStats = {
    openTickets: null,
    activeGiveaways: null,
    totalXp: null,
    topUserId: null,
  }

  if (client.db.readyState !== 1) return stats

  const tasks: Promise<void>[] = []

  if (client.enabledModules.has("Tickets")) {
    tasks.push(
      TicketRecords.countDocuments({ closedAt: null })
        .then((count) => {
          stats.openTickets = count
        })
        .catch(() => undefined)
    )
  }

  if (client.enabledModules.has("Giveaway")) {
    tasks.push(
      Giveaway.countDocuments({ ended: false, cancelled: false })
        .then((count) => {
          stats.activeGiveaways = count
        })
        .catch(() => undefined)
    )
  }

  if (client.enabledModules.has("Levels")) {
    tasks.push(
      LevelUser.aggregate<{ total: number }>([
        { $match: { botId: config.botId } },
        { $group: { _id: null, total: { $sum: "$xp" } } },
      ])
        .then((rows) => {
          stats.totalXp = rows[0]?.total ?? 0
        })
        .catch(() => undefined)
    )
    tasks.push(
      LevelUser.findOne()
        .sort({ xp: -1 })
        .select("userId")
        .lean()
        .then((doc) => {
          stats.topUserId = doc?.userId ?? null
        })
        .catch(() => undefined)
    )
  }

  await Promise.all(tasks)
  return stats
}

function buildGeneralStatsBlock(stats: GeneralStats): string {
  const lines: string[] = []

  if (stats.openTickets !== null) {
    lines.push(`> **Tickets ouverts :** \`${formatNumber(stats.openTickets)}\``)
  }
  if (stats.activeGiveaways !== null) {
    lines.push(`> **Giveaways actifs :** \`${formatNumber(stats.activeGiveaways)}\``)
  }
  if (stats.totalXp !== null) {
    const top = stats.topUserId ? ` — Top membre : <@${stats.topUserId}>` : ""
    lines.push(`> **XP total distribué :** \`${formatNumber(stats.totalXp)}\`${top}`)
  }

  if (lines.length === 0) return ""
  return `${sectionSeparator()}${appEmojiText("cog")} **Statistiques générales**\n${lines.join("\n")}`
}

async function buildEmbed(client: Client, apiPing: number): Promise<EmbedBuilder> {
  const user = client.user
  const displayName = user?.username ?? botRuntime.name
  const botId = user?.id ?? botRuntime.botId
  const createdTs = user ? Math.floor(user.createdTimestamp / 1000) : null
  const guilds = client.guilds.cache.size
  const users = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0)
  const commands = client.commands.size
  const modules = client.enabledModules.size
  const wsPing = client.ws.ping
  const uptime = client.uptime ?? 0
  const stats = await fetchGeneralStats(client)

  const developers = config.ownerId.length
    ? config.ownerId.map((id) => `<@${id}>`).join(" · ")
    : "*Non configuré*"

  const host = botRuntime.raw.vm_host?.trim()
  const hostLine = host
    ? host.startsWith("http")
      ? `[${host.replace(/^https?:\/\//, "").split("/")[0]}](${host})`
      : `\`${host}\``
    : "*Non configuré*"

  const description =
    `\`${botId}\`\n` +
    (createdTs ? `Créé le <t:${createdTs}:D>\n` : "") +
    sectionSeparator() +
    `${appEmojiText("people")} **Statistiques**\n` +
    `> **Serveurs :** \`${formatNumber(guilds)}\`\n` +
    `> **Utilisateurs :** \`${formatNumber(users)}\`\n` +
    `> **Commandes :** \`${formatNumber(commands)}\`\n` +
    `> **Latence :** \`${wsPing} ms\`` +
    sectionSeparator() +
    `${appEmojiText("check")} **Temps d'activité**\n` +
    `\`${formatTime(uptime)}\`` +
    buildGeneralStatsBlock(stats) +
    sectionSeparator() +
    `${appEmojiText("file")} **Technique**\n` +
    `> **Ping Gateway :** \`${wsPing}ms\` — ${pingLabel(wsPing)}\n` +
    `> **Ping API :** \`${apiPing}ms\`\n` +
    `> **Redémarré :** <t:${Math.floor((Date.now() - uptime) / 1000)}:R>\n` +
    `> **RAM :** \`${formatRam()}\` — **CPU moyen :** \`${formatCpu()}\`\n` +
    `> **Modules :** \`${modules}\` — **Commandes :** \`${commands}\`\n` +
    `> **discord.js :** \`${djsVersion}\`` +
    sectionSeparator() +
    `${appEmojiText("settings")} **Développeur**\n` +
    developers +
    sectionSeparator() +
    `${appEmojiText("pin")} **Hébergeur**\n` +
    hostLine

  return new EmbedBuilder()
    .setTitle(`Informations de ${displayName}`)
    .setDescription(description)
    .setThumbnail(user?.displayAvatarURL({ size: 256 }) ?? null)
    .setColor(colors.prime ?? "#5865f2")
}

function buildButtons(client: Client): ActionRowBuilder<ButtonBuilder>[] {
  const clientId = client.user?.id ?? botRuntime.raw.client_id ?? botRuntime.raw.discord_bot_id
  const supportUrl = resolveSupportUrl(botRuntime.raw)
  const row = new ActionRowBuilder<ButtonBuilder>()

  if (clientId) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("Ajouter le bot")
        .setStyle(ButtonStyle.Link)
        .setURL(inviteUrl(clientId))
    )
  }

  row.addComponents(
    new ButtonBuilder()
      .setLabel("Rejoindre le support")
      .setStyle(ButtonStyle.Link)
      .setURL(supportUrl)
  )

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(TOP3_BUTTON_ID)
      .setLabel("Top 3 Serveurs")
      .setStyle(ButtonStyle.Secondary)
  )

  return row.components.length > 0 ? [row] : []
}

export async function handleInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false
  if (interaction.customId !== TOP3_BUTTON_ID) return false

  const top = [...client.guilds.cache.values()]
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, 3)

  const lines = top.map(
    (guild, index) =>
      `${index + 1}. **${guild.name}** — \`${formatNumber(guild.memberCount)}\` membres`
  )

  await interaction.reply({
    content: lines.length
      ? `**Top 3 serveurs**\n${lines.join("\n")}`
      : "> *Aucun serveur disponible.*",
    ephemeral: true,
  })
  return true
}

export default {
  name: "botinfo",
  description: "Affiche les informations et statistiques du bot.",
  category: "utils",
  aliases: ["bi", "bot-info", "info-bot", "about"],
  permissions: [],
  usage: "",
  handleInteraction,
  async execute(client: Client, message: Message) {
    const sent = await message.reply({ content: "Chargement..." })
    const apiPing = sent.createdTimestamp - message.createdTimestamp
    const embed = await buildEmbed(client, apiPing)
    const components = buildButtons(client)

    await sent.edit({
      content: "",
      embeds: [embed],
      components,
    })
  },
}
