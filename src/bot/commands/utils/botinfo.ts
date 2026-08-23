import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  type Client,
  type Message,
} from "discord.js"
import { cpus, loadavg } from "node:os"
import { botRuntime, colors } from "../../config.js"
import { defaultMaxMemory, resolveSupportUrl } from "../../../shared/botConfig.js"
import { appEmojiComponent, appEmojiText } from "../../utils/appEmojis.js"
import formatTime from "../../utils/formatTime.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const GITHUB_REPO = "https://github.com/ZenodeCie/Bot-V2"
const GITHUB_API = "https://api.github.com/repos/ZenodeCie/Bot-V2"
const GITHUB_CACHE_TTL = 5 * 60_000

interface GithubInfo {
  stars: number
  language: string | null
  contributors: Array<{ login: string; url: string }>
}

let githubCache: { at: number; data: GithubInfo } | null = null

function accentColor(): number {
  const hex = colors.prime ?? "#5865f2"
  return Number.parseInt(hex.replace("#", ""), 16)
}

function formatNumber(value: number): string {
  return value.toLocaleString("fr-FR")
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

function hostLabel(): string {
  const host = botRuntime.raw.vm_host?.trim()
  if (!host) return "Non configuré"
  if (host.startsWith("http")) return host.replace(/^https?:\/\//, "").split("/")[0] ?? host
  return host
}

function memoryLimit(): number {
  return defaultMaxMemory(botRuntime.raw)
}

async function fetchGithubInfo(): Promise<GithubInfo> {
  if (githubCache && Date.now() - githubCache.at < GITHUB_CACHE_TTL) {
    return githubCache.data
  }

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ZenodeBot-botinfo",
  }

  try {
    const [repoRes, contribRes] = await Promise.all([
      fetch(GITHUB_API, { headers }),
      fetch(`${GITHUB_API}/contributors?per_page=5`, { headers }),
    ])

    const repo = repoRes.ok ? ((await repoRes.json()) as { stargazers_count?: number; language?: string | null }) : null
    const contributors = contribRes.ok
      ? ((await contribRes.json()) as Array<{ login?: string; html_url?: string }>)
      : []

    const data: GithubInfo = {
      stars: repo?.stargazers_count ?? 0,
      language: repo?.language ?? null,
      contributors: contributors
        .filter((c) => c.login && c.html_url)
        .map((c) => ({ login: c.login!, url: c.html_url! })),
    }

    githubCache = { at: Date.now(), data }
    return data
  } catch {
    return githubCache?.data ?? { stars: 0, language: "TypeScript", contributors: [] }
  }
}

function buildGithubBlock(info: GithubInfo): string {
  const meta = [
    info.language ? `\`${info.language}\`` : null,
    info.stars > 0 ? `⭐ \`${formatNumber(info.stars)}\`` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const contributorLinks = info.contributors.length
    ? info.contributors.map((c) => `[\`${c.login}\`](${c.url})`).join(" · ")
    : "[ZenodeCie](https://github.com/ZenodeCie)"

  return (
    `> **[ZenodeCie/Bot-V2](${GITHUB_REPO})**` +
    (meta ? `\n> ${meta}` : "") +
    `\n> ${contributorLinks}`
  )
}

async function buildContainer(client: Client, latencyMs: number): Promise<ContainerBuilder[]> {
  const github = await fetchGithubInfo()
  const user = client.user
  const name = user?.username ?? botRuntime.name
  const avatar = user?.displayAvatarURL({ size: 256 }) ?? "https://cdn.discordapp.com/embed/avatars/0.png"

  const guilds = client.guilds.cache.size
  const members = client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0)
  const uptime = client.uptime ?? 0
  const uptimeText = formatTime(uptime)

  const clientId = user?.id ?? botRuntime.raw.client_id ?? botRuntime.raw.discord_bot_id
  const supportUrl = resolveSupportUrl(botRuntime.raw)

  const container = new ContainerBuilder().setAccentColor(accentColor())

  container.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) => t.setContent(`# ${name}`))
      .addTextDisplayComponents((t) =>
        t.setContent(`> ${appEmojiText("check")} En ligne · \`${uptimeText}\``)
      )
      .setThumbnailAccessory((thumb) => thumb.setURL(avatar))
  )

  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(1))

  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> ${appEmojiText("people")} **\`${formatNumber(guilds)}\`** serveurs\n` +
        `> ${appEmojiText("people")} **\`${formatNumber(members)}\`** membres\n` +
        `> ${appEmojiText("loop")} **\`${latencyMs} ms\`** latence`
    )
  )

  container.addSeparatorComponents((s) => s.setSpacing(1))

  container.addTextDisplayComponents((t) =>
    t.setContent(
      `${appEmojiText("pin")} **Hébergement**\n` +
        `> **Serveur** \`${hostLabel()}\`\n` +
        `> **RAM** \`${formatRam()}\` / \`${memoryLimit()} Mo\` · **CPU** \`${formatCpu()}\``
    )
  )

  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addTextDisplayComponents((t) =>
    t.setContent(`${appEmojiText("settings")} **Développement**\n${buildGithubBlock(github)}`)
  )

  const buttons: ButtonBuilder[] = []
  if (clientId) {
    buttons.push(
      new ButtonBuilder()
        .setLabel("Ajouter le bot")
        .setStyle(ButtonStyle.Link)
        .setURL(inviteUrl(clientId))
        .setEmoji(appEmojiComponent("add"))
    )
  }
  buttons.push(
    new ButtonBuilder()
      .setLabel("Support")
      .setStyle(ButtonStyle.Link)
      .setURL(supportUrl)
      .setEmoji(appEmojiComponent("people"))
  )
  buttons.push(
    new ButtonBuilder()
      .setLabel("GitHub")
      .setStyle(ButtonStyle.Link)
      .setURL(GITHUB_REPO)
      .setEmoji({ id: "738960248366170225" })
  )

  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) => row.setComponents(...buttons))

  return [container]
}

function loadingContainer(): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(accentColor())
  container.addTextDisplayComponents((t) => t.setContent(`> *Chargement…*`))
  return [container]
}

export default {
  name: "botinfo",
  description: "Affiche les informations du bot.",
  category: "utils",
  aliases: ["bi", "bot-info", "info-bot", "about"],
  permissions: [],
  usage: "",
  async execute(client: Client, message: Message) {
    const sent = await message.reply({ components: loadingContainer(), flags: COMPONENTS_V2_FLAGS })
    const latencyMs = sent.createdTimestamp - message.createdTimestamp
    const components = await buildContainer(client, latencyMs)

    await sent.edit({ components, flags: COMPONENTS_V2_FLAGS })
  },
}
