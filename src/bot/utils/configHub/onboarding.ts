import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildChannel,
  type MessageCreateOptions,
  type TextChannel,
  type User,
} from "discord.js"
import { botRuntime } from "../../config.js"
import { resolveSupportUrl } from "../../../shared/botConfig.js"
import { appEmojiText } from "../appEmojis.js"
import { buildNoticeContainer, COMPONENTS_V2_FLAGS } from "../giveaway/notice.js"
import { buildMainHubContainer } from "./hub.js"

const MODULE_LABELS: Record<string, string> = {
  Base: "Base",
  Moderation: "Modération",
  ModerationAvancee: "Anti-raid",
  Utilities: "Utilitaires",
  Aeroport: "Aéroport",
  Captcha: "Captcha",
  Logs: "Logs",
  Giveaway: "Giveaway",
  Levels: "Niveaux",
  InformationPanel: "Panneau d'information",
  "Message-Horaire": "Messages horaires",
  StaffList: "Liste du staff",
  Rules: "Règlement",
  Invitations: "Invitations",
  Tickets: "Tickets",
}

function enabledModuleList(client: Client): string {
  const modules = [...client.enabledModules]
    .filter((m) => m !== "Base")
    .map((m) => MODULE_LABELS[m] ?? m)
  if (modules.length === 0) return "*Modules de base uniquement*"
  return modules.join(" · ")
}

function buildOnboardingBody(client: Client, guild: Guild, forOwner: boolean): string {
  const botName = client.user?.username ?? botRuntime.name
  const lines = [
    `> *Merci d'avoir ajouté **${botName}** sur **${guild.name}** !*`,
    "",
    `> ${appEmojiText("settings")} **Configuration**`,
    forOwner
      ? "> *Utilisez `/config` dans votre serveur pour configurer tous les modules.*"
      : "> *Un administrateur peut utiliser `/config` pour configurer tous les modules.*",
    "",
    `> ${appEmojiText("cog")} **Modules activés**`,
    `> ${enabledModuleList(client)}`,
    "",
    `> ${appEmojiText("check")} **Premiers pas**`,
    "> 1. Vérifiez que le bot a les permissions **Gérer le serveur** et **Voir les salons**",
    "> 2. Lancez `/config` et configurez les modules dont vous avez besoin",
    "> 3. Activez les **logs** et le **captcha** si vous souhaitez sécuriser le serveur",
    "> 4. Consultez `/help` pour découvrir toutes les commandes disponibles",
  ]
  return lines.join("\n")
}

function buildSupportRow(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Serveur support")
      .setStyle(ButtonStyle.Link)
      .setEmoji({ id: "1380926254261469325" })
      .setURL(resolveSupportUrl(botRuntime.raw)),
  new ButtonBuilder()
      .setLabel("GitHub")
      .setStyle(ButtonStyle.Link)
      .setEmoji({ id: "738960248366170225" })
      .setURL("https://github.com/ZenodeCie/Bot-V2/"),
  )
  return [row]
}

function onboardingPayload(client: Client, guild: Guild, forOwner: boolean): MessageCreateOptions {
  const botName = client.user?.username ?? botRuntime.name
  return {
    components: buildNoticeContainer(
      "settings",
      `Bienvenue — ${botName}`,
      buildOnboardingBody(client, guild, forOwner),
      buildSupportRow()
    ),
    flags: COMPONENTS_V2_FLAGS,
  }
}

function canSendToChannel(channel: GuildBasedChannel, guild: Guild): boolean {
  const me = guild.members.me
  if (!me) return false
  const perms = channel.permissionsFor(me)
  return (
    channel.isTextBased() &&
    (perms?.has(PermissionFlagsBits.ViewChannel) ?? false) &&
    (perms?.has(PermissionFlagsBits.SendMessages) ?? false)
  )
}

export function findWelcomeChannel(guild: Guild): TextChannel | null {
  if (guild.systemChannel && canSendToChannel(guild.systemChannel, guild)) {
    return guild.systemChannel
  }

  const candidate = guild.channels.cache
    .filter((channel) => canSendToChannel(channel, guild))
    .sort((a, b) => (a as GuildChannel).rawPosition - (b as GuildChannel).rawPosition)
    .first()

  return candidate?.isTextBased() ? (candidate as TextChannel) : null
}

async function sendOwnerDm(client: Client, guild: Guild, owner: User): Promise<void> {
  const payload = onboardingPayload(client, guild, true)
  await owner.send(payload)
}

async function sendChannelWelcome(client: Client, guild: Guild): Promise<void> {
  const channel = findWelcomeChannel(guild)
  if (!channel) return
  await channel.send(onboardingPayload(client, guild, false))
}

export async function sendGuildOnboarding(client: Client, guild: Guild): Promise<void> {
  try {
    await sendChannelWelcome(client, guild)
  } catch (error) {
    console.error(`Failed to send onboarding message in guild ${guild.id}:`, error)
  }

  try {
    const owner = await guild.fetchOwner()
    await sendOwnerDm(client, guild, owner.user)
  } catch (error) {
    console.error(`Failed to send onboarding DM to guild ${guild.id} owner:`, error)
  }
}

export function buildOnboardingPreview(client: Client, guild: Guild) {
  return buildMainHubContainer(client)
}
