import {
  ApplicationCommandOptionType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ThumbnailBuilder,
  type Client,
  type Guild,
  type Message,
} from "discord.js"
import { appEmojiText, type AppEmojiName } from "../../utils/appEmojis.js"
import { logCommandUse, replyError, requireGuild, resolveTarget } from "../../utils/moderation/helpers.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x2b2d31

const STATUS_EMOJIS: Record<string, AppEmojiName> = {
  online: "check",
  idle: "loop",
  dnd: "cancel",
  offline: "file",
}

const STATUS_LABELS: Record<string, string> = {
  online: "En ligne",
  idle: "Inactif",
  dnd: "Ne pas déranger",
  offline: "Hors ligne",
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  web: "Web",
}

async function renderCard(client: Client, guildId: string, targetId: string): Promise<ContainerBuilder[]> {
  const guild: Guild | null = client.guilds.cache.get(guildId) ?? null
  const member = guild ? await guild.members.fetch(targetId).catch(() => null) : null
  let user = member?.user ?? null
  if (!user) {
    user = await client.users.fetch(targetId).catch(() => null)
  } else {
    user = await user.fetch().catch(() => user)
  }

  const username = user?.username ?? "Utilisateur inconnu"
  const displayName = user?.globalName ?? member?.nickname ?? username
  const statusRaw = member?.presence?.status ?? "offline"
  const statusName = STATUS_EMOJIS[statusRaw] ?? "file"
  const statusLabel = STATUS_LABELS[statusRaw] ?? "Hors ligne"
  const statusTag = `${appEmojiText(statusName)} \`${statusLabel}\``
  const deviceKey = member?.presence
    ? member.presence.clientStatus?.desktop
      ? "desktop"
      : member.presence.clientStatus?.mobile
        ? "mobile"
        : member.presence.clientStatus?.web
          ? "web"
          : ""
    : ""
  const deviceTag = deviceKey ? `${appEmojiText("cog")} ${DEVICE_LABELS[deviceKey]}` : "—"

  const badges: string[] = []
  if (member?.premiumSince) badges.push(`-# ${appEmojiText("power")} Boost`)
  if (user?.bot) badges.push(`-# ${appEmojiText("pin")}\n\`BOT\``)

  const roles = member
    ? [...member.roles.cache.values()]
        .filter((r) => r.id !== member.guild.id)
        .sort((a, b) => b.position - a.position)
    : []
  const topRole = roles[0] ?? null
  const rolesText: string[] = roles.slice(0, 8).map((r) => r.toString())
  if (roles.length > 8) rolesText.push("…")

  const profile = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)

  const bannerUrl = user?.bannerURL({ size: 4096 }) ?? guild?.bannerURL({ size: 4096 }) ?? null
  if (bannerUrl) {
    const item = new MediaGalleryItemBuilder({ media: { url: bannerUrl } })
    profile.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item))
  }

  profile.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(`## **${displayName}**${badges.length > 0 ? `\n${badges.join("\n")}` : ""}`)
      )
      .addTextDisplayComponents((t) =>
        t.setContent(`<@${targetId}> \n(\`${username}\`) ${statusTag}`)
      )
      .setThumbnailAccessory((thumb) =>
        thumb.setURL(user?.displayAvatarURL({ size: 128 }) ?? "https://cdn.discordapp.com/embed/avatars/0.png")
      )
  )

  profile.addSeparatorComponents((s) => s.setDivider(true).setSpacing(1))

  const createdTs = user ? Math.floor(user.createdTimestamp / 1000) : null
  const joinedTs = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null

  profile.addTextDisplayComponents((t) =>
    t.setContent(
      `${appEmojiText("loop")} **Création du compte** ${createdTs ? `<t:${createdTs}:d> (<t:${createdTs}:R>)` : "—"}`
    )
  )
  profile.addTextDisplayComponents((t) =>
    t.setContent(`${appEmojiText("loop")} **Membre depuis** ${joinedTs ? `<t:${joinedTs}:d> (<t:${joinedTs}:R>)` : "*A quitté le serveur*"}`)
  )
  profile.addTextDisplayComponents((t) =>
    t.setContent(
      `${appEmojiText("people")} **Rôles** (**${roles.length}**)\n` +
        `> ${rolesText.length > 0 ? rolesText.join(" ") : "*Aucun rôle*"}`
    )
  )
  if (topRole) {
    profile.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("people")} **Rôle principal** : ${topRole}`))
  }
  if (member?.presence) {
    profile.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("cog")} **Appareil** : ${deviceTag}`))
  }

  profile.addSeparatorComponents((s) => s.setSpacing(1))
  profile.addTextDisplayComponents((t) => t.setContent(`-# ${appEmojiText("file")} \`${targetId}\``))

  return [profile]
}

export default {
  name: "userinfo",
  description: "Affiche les informations de base d'un membre.",
  category: "utils",
  aliases: ["fiche", "card", "ui"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur|id>",
  slash: [
    { name: "utilisateur", description: "Membre à inspecter", type: ApplicationCommandOptionType.User, required: false },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("userinfo", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const resolved = await resolveTarget(client, guild, args[0] ?? _message.author.id, false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target

    const containers = await renderCard(client, guild.id, target.id)
    await _message.reply({ components: containers, flags: COMPONENTS_V2_FLAGS, allowedMentions: { parse: [] } })
  },
}