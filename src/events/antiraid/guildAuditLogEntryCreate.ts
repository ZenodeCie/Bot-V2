import { AuditLogEvent, type Client, type Guild, type GuildAuditLogsEntry } from "discord.js"

const ACTIONS: Partial<Record<AuditLogEvent, string>> = {
  [AuditLogEvent.ChannelCreate]: "channelCreate",
  [AuditLogEvent.ChannelDelete]: "channelDelete",
  [AuditLogEvent.RoleCreate]: "roleCreate",
  [AuditLogEvent.RoleDelete]: "roleDelete",
  [AuditLogEvent.MemberBanAdd]: "ban",
}

export default {
  name: "guildAuditLogEntryCreate",
  async execute(client: Client, entry: GuildAuditLogsEntry, guild: Guild) {
    const type = ACTIONS[entry.action]
    if (!type) return
    if (typeof entry.targetId !== "string") return
    await client.antiraid.handleDestructive(client, guild, entry.executorId ?? null, type, entry.targetId)
  },
}
