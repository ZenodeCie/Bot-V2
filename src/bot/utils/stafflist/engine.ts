import {
  ContainerBuilder,
  MessageFlags,
  type Client,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type PartialGuildMember,
  type Presence,
  type Role,
} from "discord.js"
import { getConfig, listEnabledLists, MAX_ROLES, updateConfig, type StaffListConfig } from "./schema.js"
import { appEmojiText, type AppEmojiName } from "../appEmojis.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e
const EDIT_DEBOUNCE = 3_000
const TEXT_LIMIT = 4000

const STATUS_EMOJI: Record<string, AppEmojiName> = {
  online: "check",
  idle: "loop",
  dnd: "cancel",
  offline: "file",
}

export type PublishResult = { ok: true; config: StaffListConfig } | { ok: false; error: string }

const pendingEdits = new Map<string, NodeJS.Timeout>()

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function statusOf(member: GuildMember): string {
  return member.presence?.status ?? "offline"
}

function statusRank(member: GuildMember): number {
  const status = statusOf(member)
  if (status === "online") return 0
  if (status === "idle") return 1
  if (status === "dnd") return 2
  return 3
}

function statusEmoji(member: GuildMember): string {
  return appEmojiText(STATUS_EMOJI[statusOf(member)] ?? STATUS_EMOJI.offline)
}

function touchesStaffRoles(roleIds: string[], ...members: Array<GuildMember | PartialGuildMember | null | undefined>): boolean {
  if (roleIds.length === 0) return false
  return members.some((member) => {
    if (!member) return false
    if ("partial" in member && member.partial && member.roles.cache.size === 0) return true
    return roleIds.some((id) => member.roles.cache.has(id))
  })
}

async function resolveTextChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null
  return channel
}

async function ensureMemberCache(guild: Guild): Promise<void> {
  if (guild.members.cache.size >= Math.max(1, Math.floor(guild.memberCount * 0.8))) return
  await guild.members.fetch().catch(() => undefined)
}

function sortMembers(members: GuildMember[], showStatus: boolean): GuildMember[] {
  return [...members].sort((a, b) => {
    if (showStatus) {
      const rank = statusRank(a) - statusRank(b)
      if (rank !== 0) return rank
    }
    return a.displayName.localeCompare(b.displayName, "fr")
  })
}

function buildRoleBlock(roleLabel: string, members: GuildMember[], config: StaffListConfig): string {
  const header = `**${roleLabel}**`
  if (members.length === 0) return `${header}\n> *Aucun membre*`

  const lines: string[] = []
  let omitted = 0
  for (const member of members) {
    const line = config.showStatus ? `> ${statusEmoji(member)} <@${member.id}>` : `> <@${member.id}>`
    const next = `${header}\n${[...lines, line].join("\n")}`
    if (next.length > TEXT_LIMIT - 40) {
      omitted = members.length - lines.length
      break
    }
    lines.push(line)
  }
  if (omitted > 0) lines.push(`> *… et ${omitted} de plus*`)
  return `${header}\n${lines.join("\n")}`
}

function packBlocks(blocks: string[]): string[] {
  const packed: string[] = []
  let current = ""
  for (const block of blocks) {
    const clipped = clip(block, TEXT_LIMIT)
    const next = current ? `${current}\n\n${clipped}` : clipped
    if (next.length > TEXT_LIMIT) {
      if (current) packed.push(current)
      current = clipped
    } else {
      current = next
    }
  }
  if (current) packed.push(current)
  return packed
}

export async function buildPublicContainer(guild: Guild, config: StaffListConfig): Promise<ContainerBuilder[]> {
  await ensureMemberCache(guild)

  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  const title = clip(config.title.trim() || "Liste du Staff", 256)
  container.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("people")} 〃 ${title}`))
  container.addSeparatorComponents((s) => s.setSpacing(1))

  if (config.description.trim()) {
    container.addTextDisplayComponents((t) => t.setContent(`> *${clip(config.description.trim(), 1000)}*`))
    container.addSeparatorComponents((s) => s.setDivider(true))
  }

  if (config.roleIds.length === 0) {
    container.addTextDisplayComponents((t) =>
      t.setContent("> *Aucun rôle staff n'est configuré. Ajoutez des rôles dans le panneau.*")
    )
    return [container]
  }

  const blocks: string[] = []
  for (const roleId of config.roleIds.slice(0, MAX_ROLES)) {
    const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null))
    const label = role ? `${role}` : `\`${roleId}\` *(introuvable)*`
    const members = sortMembers(
      guild.members.cache.filter((member) => {
        if (!member.roles.cache.has(roleId)) return false
        if (config.ignoreBots && member.user.bot) return false
        return true
      }).map((member) => member),
      config.showStatus
    )
    blocks.push(buildRoleBlock(label, members, config))
  }

  for (const block of packBlocks(blocks)) {
    container.addTextDisplayComponents((t) => t.setContent(block))
  }
  return [container]
}

function clearEditDebounce(guildId: string): void {
  const timer = pendingEdits.get(guildId)
  if (!timer) return
  clearTimeout(timer)
  pendingEdits.delete(guildId)
}

export function scheduleMessageRefresh(client: Client, guildId: string): void {
  clearEditDebounce(guildId)
  const timer = setTimeout(() => {
    pendingEdits.delete(guildId)
    void publishStaffList(client, guildId).catch((error) =>
      console.error(`Failed to refresh staff list ${guildId}:`, error)
    )
  }, EDIT_DEBOUNCE)
  timer.unref()
  pendingEdits.set(guildId, timer)
}

export async function publishStaffList(client: Client, guildId: string): Promise<PublishResult> {
  const config = await getConfig(guildId)
  if (!config.channelId) {
    return { ok: false, error: "> *Configurez encore un **salon**.*" }
  }

  const channel = await resolveTextChannel(client, config.channelId)
  if (!channel) {
    return { ok: false, error: "> *Impossible d'accéder au salon. Vérifiez les permissions du bot.*" }
  }

  const guild = channel.guild
  const components = await buildPublicContainer(guild, config)
  let messageId = config.messageId

  if (messageId) {
    const existing = await channel.messages.fetch(messageId).catch(() => null)
    if (existing) {
      const edited = await existing
        .edit({
          components,
          flags: COMPONENTS_V2_FLAGS,
          allowedMentions: { parse: [] },
        })
        .catch((error: unknown) => {
          console.error(`Failed to edit staff list in guild ${guildId}:`, error)
          return null
        })
      if (!edited) {
        return { ok: false, error: "> *Impossible de mettre à jour la liste. Vérifiez les permissions du bot.*" }
      }
    } else {
      messageId = null
    }
  }

  if (!messageId) {
    const sent = await channel
      .send({
        components,
        flags: COMPONENTS_V2_FLAGS,
        allowedMentions: { parse: [] },
      })
      .catch((error: unknown) => {
        console.error(`Failed to send staff list in guild ${guildId}:`, error)
        return null
      })
    if (!sent) {
      return { ok: false, error: "> *Impossible d'envoyer la liste dans ce salon. Vérifiez les permissions du bot.*" }
    }
    messageId = sent.id
  }

  const updated = await updateConfig(guildId, { $set: { messageId } })
  return { ok: true, config: updated }
}

export async function republishIfPublished(client: Client, guildId: string): Promise<void> {
  const config = await getConfig(guildId)
  if (!config.enabled || !config.channelId) return
  scheduleMessageRefresh(client, guildId)
}

async function refreshIfStaffTouched(
  client: Client,
  guildId: string,
  ...members: Array<GuildMember | PartialGuildMember | null | undefined>
): Promise<void> {
  const config = await getConfig(guildId)
  if (!config.enabled || !config.channelId || config.roleIds.length === 0) return
  if (!touchesStaffRoles(config.roleIds, ...members)) return
  scheduleMessageRefresh(client, guildId)
}

export async function handleMemberJoin(client: Client, member: GuildMember): Promise<void> {
  await refreshIfStaffTouched(client, member.guild.id, member)
}

export async function handleMemberRemove(client: Client, member: GuildMember | PartialGuildMember): Promise<void> {
  await refreshIfStaffTouched(client, member.guild.id, member)
}

export async function handleMemberUpdate(
  client: Client,
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): Promise<void> {
  const config = await getConfig(newMember.guild.id)
  if (!config.enabled || !config.channelId || config.roleIds.length === 0) return
  if (oldMember.partial) {
    await refreshIfStaffTouched(client, newMember.guild.id, newMember)
    return
  }
  const oldStaff = config.roleIds.filter((id) => oldMember.roles.cache.has(id)).join(",")
  const newStaff = config.roleIds.filter((id) => newMember.roles.cache.has(id)).join(",")
  if (oldStaff === newStaff) return
  scheduleMessageRefresh(client, newMember.guild.id)
}

export async function handlePresenceUpdate(
  client: Client,
  oldPresence: Presence | null,
  newPresence: Presence
): Promise<void> {
  if (oldPresence?.status === newPresence.status) return
  const guild = newPresence.guild
  const member = newPresence.member
  if (!guild || !member) return
  const config = await getConfig(guild.id)
  if (!config.enabled || !config.channelId || !config.showStatus || config.roleIds.length === 0) return
  if (!touchesStaffRoles(config.roleIds, member)) return
  scheduleMessageRefresh(client, guild.id)
}

export async function handleRoleDelete(client: Client, role: Role): Promise<void> {
  const config = await getConfig(role.guild.id)
  if (!config.roleIds.includes(role.id)) return
  await updateConfig(role.guild.id, { $pull: { roleIds: role.id } })
  await republishIfPublished(client, role.guild.id)
}

export async function initStaffLists(client: Client): Promise<void> {
  const lists = await listEnabledLists()
  for (const list of lists) {
    await publishStaffList(client, list.guildId).catch((error) =>
      console.error(`Failed to restore staff list ${list.guildId}:`, error)
    )
  }
  console.log(`StaffList: ${lists.length} liste(s) restaurée(s) après redémarrage.`)
}
