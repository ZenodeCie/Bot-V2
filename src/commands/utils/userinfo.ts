import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ThumbnailBuilder,
  type Client,
  type Guild,
  type Message,
} from "discord.js"
import { logCommandUse, replyError, requireGuild, resolveTarget } from "../../utils/moderation/helpers.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x2b2d31

const E = {
  battery: "<:a_battery:1536875424137740300>",
  bosskey: "<:a_bosskey:1536875422137196675>",
  chat: "<:a_chat:1536875420824248350>",
  coffee: "<:a_coffee:1536875419335270470>",
  compass: "<:a_compass:1536875417879715930>",
  crown: "<:a_crown:1536875415761854599>",
  cursor: "<:a_cursor:1536875414507495554>",
  dpad: "<:a_dpad:1536875412234174516>",
  flag: "<:a_flag:1536875410363785256>",
  flame: "<:a_flame:1536875392575737986>",
  flower: "<:a_flower:1536875394513510490>",
  goldstar: "<:a_goldstar:1536875396212199527>",
  hammer: "<:a_hammer:1536875399299203245>",
  hourglass: "<:a_hourglass:1536875401182191707>",
  lightbulb: "<:a_lightbulb:1536875403845705858>",
  pc: "<:a_pc:1536875405229826150>",
  plug: "<:a_powerplug:1536875406563483762>",
  present: "<:a_present:1536875408652505159>",
  reset: "<:a_resetbutton:1536875390734442567>",
  rocket: "<:a_rocket:1536875388398215290>",
  skull: "<:a_skull:1536875386653380630>",
  target: "<:a_target:1536875375743991909>",
  tools: "<:a_tools:1536875374217265202>",
  trophy: "<:a_trophy:1536875371503419453>",
} as const

const STATUS_TAGS: Record<string, string> = {
  online: `${E.plug} \`En ligne\``,
  idle: `${E.coffee} \`Inactif\``,
  dnd: `${E.skull} \`Ne pas déranger\``,
  offline: `${E.reset} \`Hors ligne\``,
}

const DEVICE_TAGS: Record<string, string> = {
  desktop: `${E.pc} Desktop`,
  mobile: `${E.dpad} Mobile`,
  web: `${E.cursor} Web`,
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
  const statusTag = STATUS_TAGS[statusRaw] ?? STATUS_TAGS.offline
  const deviceTag = member?.presence
    ? (DEVICE_TAGS[member.presence.clientStatus?.desktop ? "desktop" : member.presence.clientStatus?.mobile ? "mobile" : member.presence.clientStatus?.web ? "web" : ""] ?? "—")
    : "—"

  const badges: string[] = []
  if (member?.premiumSince) badges.push(`-# ${E.goldstar} Boost`)
  if (user?.bot) badges.push(`-# ${E.pc}\n\`BOT\``)

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
      `${E.hourglass} **Création du compte** ${createdTs ? `<t:${createdTs}:d> (<t:${createdTs}:R>)` : "—"}`
    )
  )
  profile.addTextDisplayComponents((t) =>
    t.setContent(`${E.rocket} **Membre depuis** ${joinedTs ? `<t:${joinedTs}:d> (<t:${joinedTs}:R>)` : "*A quitté le serveur*"}`)
  )
  profile.addTextDisplayComponents((t) =>
    t.setContent(
      `${E.flag} **Rôles** (**${roles.length}**)\n` +
        `> ${rolesText.length > 0 ? rolesText.join(" ") : "*Aucun rôle*"}`
    )
  )
  if (topRole) {
    profile.addTextDisplayComponents((t) => t.setContent(`${E.crown} **Rôle principal** : ${topRole}`))
  }
  if (member?.presence) {
    profile.addTextDisplayComponents((t) => t.setContent(`${E.battery} **Appareil** : ${deviceTag}`))
  }

  profile.addSeparatorComponents((s) => s.setSpacing(1))
  profile.addTextDisplayComponents((t) => t.setContent(`-# ${E.target} \`${targetId}\``))

  return [profile]
}

export default {
  name: "userinfo",
  description: "Affiche les informations de base d'un membre.",
  category: "utils",
  aliases: ["fiche", "card", "ui"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur|id>",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("userinfo", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const resolved = await resolveTarget(client, guild, args[0] ?? _message.author.id, false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target

    const containers = await renderCard(client, guild.id, target.id)
    await _message.reply({ components: containers, flags: COMPONENTS_V2_FLAGS })
  },
}