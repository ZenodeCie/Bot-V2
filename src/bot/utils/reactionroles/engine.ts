import {
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Role,
} from "discord.js"
import { emojiDisplay, emojiKey, type RolePanel, type RolePanelEntry } from "./schema.js"
import { reactionRoleStore, type ReactionRoleStore } from "./storage.js"
import { formatDurationMs, joinRoleNames, responseText } from "./messages.js"
import { addTempGrant, cancelTempGrantsForEntry, cancelTimersForPanel } from "./temp.js"
import { enqueueRoleOp } from "./roleQueue.js"

/**
 * Moteur coeur des rôles-réactions : grant/revoke, modes, restrictions,
 * hiérarchie & rôles dangereux, limite de rôles, cooldown, logs/DM.
 */

export const RR_BUTTON_PREFIX = "rrb:"
export const RR_SELECT_PREFIX = "rrs:"

export const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
] as const

export function roleIsDangerous(role: Role): boolean {
  return DANGEROUS_PERMISSIONS.some((permission) => role.permissions.has(permission))
}

export interface GrantSummary {
  granted: string[]
  removed: string[]
  reasons: string[]
}

interface ApplyContext {
  guild: Guild
  member: GuildMember
  panel: RolePanel
  entry: RolePanelEntry
  interaction?: Interaction
  source: "reaction" | "button" | "select"
  summary?: GrantSummary
}

interface RoleResolveResult {
  role: Role | null
  reason: string | null
}

export class ReactionRolesEngine {
  private readonly panelsByMessage = new Map<string, RolePanel>()
  private readonly cooldowns = new Map<string, number>()

  constructor(private readonly client: Client) {}

  store(): ReactionRoleStore {
    return reactionRoleStore()
  }

  // -------------------------------------------------------------------------
  // Cache messageId → panel
  // -------------------------------------------------------------------------

  async rebuildMessageCache(): Promise<void> {
    const panels = await this.store().listAllPanels().catch(() => [])
    this.panelsByMessage.clear()
    for (const panel of panels) {
      if (panel.messageId) this.panelsByMessage.set(panel.messageId, panel)
    }
  }

  cachePanelMessage(panel: RolePanel): void {
    if (panel.messageId) this.panelsByMessage.set(panel.messageId, panel)
    else this.panelsByMessage.delete(panel.messageId ?? "")
  }

  panelForMessage(messageId: string): RolePanel | undefined {
    return this.panelsByMessage.get(messageId)
  }

  // -------------------------------------------------------------------------
  // CRUD paniers (via le store) + cache
  // -------------------------------------------------------------------------

  async getPanels(guildId: string): Promise<RolePanel[]> {
    return this.store().listPanels(guildId).catch(() => [])
  }

  async getPanel(guildId: string, panelId: string): Promise<RolePanel | null> {
    return this.store().getPanel(guildId, panelId).catch(() => null)
  }

  async savePanel(panel: RolePanel): Promise<void> {
    panel.updatedAt = Date.now()
    await this.store().savePanel(panel)
    this.cachePanelMessage(panel)
  }

  async deletePanel(guildId: string, panelId: string): Promise<void> {
    await this.store().deletePanel(guildId, panelId).catch(() => undefined)
    await this.store().deleteGrantsForPanel(guildId, panelId).catch(() => undefined)
    cancelTimersForPanel(guildId, panelId)
    for (const [messageId, panel] of this.panelsByMessage) {
      if (panel.id === panelId && panel.guildId === guildId) this.panelsByMessage.delete(messageId)
    }
  }

  // -------------------------------------------------------------------------
  // Cooldown (mémoire, par membre+panel)
  // -------------------------------------------------------------------------

  private cooldownKey(guildId: string, userId: string, panelId: string): string {
    return `${guildId}:${userId}:${panelId}`
  }

  private remainingCooldown(guildId: string, userId: string, panelId: string): number {
    const expiresAt = this.cooldowns.get(this.cooldownKey(guildId, userId, panelId))
    if (!expiresAt) return 0
    if (expiresAt <= Date.now()) {
      this.cooldowns.delete(this.cooldownKey(guildId, userId, panelId))
      return 0
    }
    return expiresAt - Date.now()
  }

  private applyCooldown(panel: RolePanel, guildId: string, userId: string): void {
    if (panel.cooldownMs === null) return
    this.cooldowns.set(this.cooldownKey(guildId, userId, panel.id), Date.now() + panel.cooldownMs)
  }

  // -------------------------------------------------------------------------
  // Validations rôle
  // -------------------------------------------------------------------------

  private panelRoles(panel: RolePanel): string[] {
    const out = new Set<string>()
    for (const entry of panel.entries) {
      for (const roleId of entry.roles) out.add(roleId)
    }
    return [...out]
  }

  private canOperateRole(guild: Guild, role: Role): { ok: boolean; reason?: string } {
    if (role.managed) return { ok: false, reason: "rôle géré par une intégration (impossible à attribuer)" }
    if (role.id === guild.roles.everyone.id) return { ok: false, reason: "rôle @everyone" }
    const me = guild.members.me
    if (!me) return { ok: false, reason: "bot non résolu" }
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return { ok: false, reason: "le bot n'a pas la permission Gérer les rôles (ManageRoles)" }
    }
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      return { ok: false, reason: `rôle trop haut dans la hiérarchie (le rôle du bot doit être au-dessus)` }
    }
    return { ok: true }
  }

  private async resolveEntryRoles(guild: Guild, panel: RolePanel, roleIds: string[]): Promise<RoleResolveResult[]> {
    const out: RoleResolveResult[] = []
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null))
      if (!role) {
        out.push({ role: null, reason: `<@&${roleId}> : rôle introuvable` })
        continue
      }
      const manage = this.canOperateRole(guild, role)
      if (!manage.ok) {
        out.push({ role, reason: `<@&${roleId}> : ${manage.reason}` })
        continue
      }
      if (roleIsDangerous(role) && !panel.allowDangerousRoles) {
        out.push({ role, reason: `<@&${roleId}> : rôle dangereux (Administrateur/Gérer le serveur/Gérer les rôles/Gérer les salons) — non autorisé` })
        continue
      }
      out.push({ role, reason: null })
    }
    return out
  }

  // -------------------------------------------------------------------------
  // Restrictions d'accès
  // -------------------------------------------------------------------------

  private accessDenialReason(guild: Guild, member: GuildMember, panel: RolePanel, entry: RolePanelEntry): string | null {
    void guild
    if (!panel.enabled) return "panel désactivé"
    if (!entry.enabled) return "entrée désactivée"
    if (entry.deniedRoles.length > 0 && entry.deniedRoles.some((roleId) => member.roles.cache.has(roleId))) {
      return "vous détenez un rôle interdit pour cette entrée"
    }
    if (entry.requiredRoles.length > 0 && !entry.requiredRoles.some((roleId) => member.roles.cache.has(roleId))) {
      return "un rôle requis est manquant pour cette entrée"
    }
    if (entry.minAccountAgeMs !== null && Date.now() - member.user.createdTimestamp < entry.minAccountAgeMs) {
      return `compte Discord trop récent (minimum ${formatDurationMs(entry.minAccountAgeMs)})`
    }
    if (entry.minMemberAgeMs !== null && member.joinedTimestamp !== null) {
      const age = Date.now() - member.joinedTimestamp
      if (member.joinedTimestamp !== null && age < entry.minMemberAgeMs) {
        return `membre trop récent sur le serveur (minimum ${formatDurationMs(entry.minMemberAgeMs)})`
      }
    }
    return null
  }

  // -------------------------------------------------------------------------
  // Feedback / DM / logs
  // -------------------------------------------------------------------------

  private roleNames(guild: Guild, roleIds: string[]): string[] {
    const names: string[] = []
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId)
      names.push(role ? role.name : `<@&${roleId}>`)
    }
    return names
  }

  private buildVars(guild: Guild, member: GuildMember, panel: RolePanel, entry: RolePanelEntry, roleIds: string[]): Record<string, string> {
    const names = this.roleNames(guild, roleIds)
    return {
      user: member.user.username,
      userMention: `<@${member.id}>`,
      role: joinRoleNames(names, panel.language),
      roleMention: names.map((name) => `**${name}**`).join(", "),
      server: guild.name,
      panel: panel.name || panel.id,
      emoji: emojiDisplay(entry.emoji),
      duration: entry.durationMs !== null ? formatDurationMs(entry.durationMs) : "",
      reason: "",
    }
  }

  private async sendPanelLog(guild: Guild, panel: RolePanel, text: string): Promise<void> {
    if (!panel.logChannelId || !text) return
    const channel = await guild.channels.fetch(panel.logChannelId).catch(() => null)
    if (!channel || !("send" in channel)) return
    await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined)
  }

  private async notifyDM(member: GuildMember, text: string): Promise<void> {
    if (!text) return
    await member.send(text).catch(() => undefined)
  }

  private async afterSuccess(
    ctx: ApplyContext,
    kind: "grant" | "remove",
    grantedRoles: string[],
    removedRoles: string[]
  ): Promise<void> {
    const { guild, member, panel, entry, summary } = ctx
    const relevant = kind === "grant" ? grantedRoles : removedRoles
    if (summary) {
      if (kind === "grant") summary.granted.push(...this.roleNames(guild, relevant))
      else summary.removed.push(...this.roleNames(guild, relevant))
      return
    }
    const vars = this.buildVars(guild, member, panel, entry, relevant)
    const textKey = kind === "grant" ? "granted" : "removed"
    if (ctx.interaction) {
      await replyFeedback(ctx.interaction, responseText(panel, textKey, vars))
    }
    if (panel.dmNotify) {
      await this.notifyDM(member, responseText(panel, kind === "grant" ? "dmGranted" : "dmRemoved", vars))
    }
    await this.sendPanelLog(guild, panel, responseText(panel, kind === "grant" ? "logGrant" : "logRemove", vars))
  }

  // -------------------------------------------------------------------------
  // Cœur grant / revoke
  // -------------------------------------------------------------------------

  private async grantEntry(ctx: ApplyContext): Promise<boolean> {
    const { guild, member, panel, entry, summary } = ctx

    if (ctx.source === "reaction" || ctx.source === "button") {
      const wait = this.remainingCooldown(guild.id, member.id, panel.id)
      if (wait > 0) {
        if (ctx.interaction) await replyFeedback(ctx.interaction, responseText(panel, "cooldown"))
        return false
      }
    }

    const restriction = this.accessDenialReason(guild, member, panel, entry)
    if (restriction) {
      const reason = restriction
      const denyText = responseText(panel, "denied", { ...this.buildVars(guild, member, panel, entry, entry.roles), reason })
      if (summary) summary.reasons.push(denyText)
      else if (ctx.interaction) await replyFeedback(ctx.interaction, denyText)
      await this.sendPanelLog(guild, panel, responseText(panel, "logDeny", { ...this.buildVars(guild, member, panel, entry, entry.roles), reason }))
      return false
    }

    const resolved = await this.resolveEntryRoles(guild, panel, entry.roles)
    const blocked = resolved.filter((item) => item.reason !== null)
    if (blocked.length > 0) {
      const reason = blocked.map((item) => item.reason ?? "").join(", ")
      const denyText = responseText(panel, "denied", { ...this.buildVars(guild, member, panel, entry, entry.roles), reason })
      if (summary) summary.reasons.push(denyText)
      else if (ctx.interaction) await replyFeedback(ctx.interaction, denyText)
      await this.sendPanelLog(guild, panel, responseText(panel, "logDeny", { ...this.buildVars(guild, member, panel, entry, entry.roles), reason }))
      return false
    }

    const grantedRoleIds = entry.roles
    const heldCount = this.panelRoles(panel).filter((roleId) => member.roles.cache.has(roleId)).length
    if (panel.maxRoles !== null && heldCount + grantedRoleIds.filter((roleId) => !member.roles.cache.has(roleId)).length > panel.maxRoles) {
      if (summary) summary.reasons.push(responseText(panel, "limit"))
      else if (ctx.interaction) await replyFeedback(ctx.interaction, responseText(panel, "limit"))
      return false
    }

    if (panel.mode === "unique") {
      const others = this.panelRoles(panel).filter((roleId) => !grantedRoleIds.includes(roleId) && member.roles.cache.has(roleId))
      for (const roleId of others) {
        await enqueueRoleOp(guild.id, () =>
          member.roles.remove(roleId, `ZenodeBots — mode unique (panel ${panel.name || panel.id})`).then(() => undefined)
        ).catch(() => undefined)
      }
    }

    const addOps = grantedRoleIds.map((roleId) =>
      enqueueRoleOp(guild.id, () =>
        member.roles.add(roleId, `ZenodeBots — panel ${panel.name || panel.id}`).then(() => undefined)
      )
    )
    const removeOps = entry.removeRoles.map((roleId) =>
      enqueueRoleOp(guild.id, () =>
        member.roles.remove(roleId, `ZenodeBots — entrée ${panel.name || panel.id}`).then(() => undefined)
      )
    )

    const results = await Promise.allSettled([...addOps, ...removeOps])
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected")
    if (failures.length > 0) {
      if (!summary && ctx.interaction) {
        await replyFeedback(ctx.interaction, responseText(panel, "error"))
      }
      return false
    }

    this.applyCooldown(panel, guild.id, member.id)

    if (entry.durationMs !== null) {
      const expiresAt = Date.now() + entry.durationMs
      for (const roleId of grantedRoleIds) {
        void addTempGrant(this.client, panel.id, entry.id, guild.id, member.id, roleId, expiresAt).catch(() => undefined)
      }
    }

    await this.afterSuccess(ctx, "grant", grantedRoleIds, entry.removeRoles)
    return true
  }

  private async revokeEntry(ctx: ApplyContext): Promise<boolean> {
    const { guild, member, panel, entry, summary } = ctx

    const toRemove = entry.roles.filter((roleId) => member.roles.cache.has(roleId))
    for (const roleId of toRemove) {
      await enqueueRoleOp(guild.id, () =>
        member.roles.remove(roleId, `ZenodeBots — retrait (panel ${panel.name || panel.id})`).then(() => undefined)
      ).catch(() => undefined)
    }
    cancelTempGrantsForEntry(guild.id, member.id, panel.id, entry.id)

    if (toRemove.length === 0) return false
    await this.afterSuccess(ctx, "remove", [], toRemove)
    return true
  }

  private async toggleEntry(ctx: ApplyContext): Promise<void> {
    const held = ctx.entry.roles.length > 0 && ctx.entry.roles.every((roleId) => ctx.member.roles.cache.has(roleId))
    if (held) await this.revokeEntry(ctx)
    else await this.grantEntry(ctx)
  }

  // -------------------------------------------------------------------------
  // Entrées publiques (events + interactions)
  // -------------------------------------------------------------------------

  async applyReaction(guild: Guild, member: GuildMember, panel: RolePanel, reactionEmojiKey: string, adding: boolean): Promise<void> {
    const entry = panel.entries.find(
      (item) => item.enabled && item.entryType === "reaction" && emojiKey(item.emoji) === reactionEmojiKey
    )
    if (!entry) return
    const ctx: ApplyContext = { guild, member, panel, entry, source: "reaction" }
    if (adding) {
      if (panel.mode === "drop" || panel.mode === "reversed") await this.revokeEntry(ctx)
      else await this.grantEntry(ctx)
    } else {
      if (panel.mode === "verify" || panel.mode === "drop") return
      if (panel.mode === "reversed") await this.grantEntry(ctx)
      else await this.revokeEntry(ctx)
    }
  }

  /** Retourne true si l'interaction bouton appartient vraiment au module. */
  async applyButton(guild: Guild, member: GuildMember, panel: RolePanel, entryId: string, interaction: Interaction): Promise<boolean> {
    const entry = panel.entries.find((item) => item.id === entryId)
    if (!entry || entry.entryType !== "button") return false
    if (!panel.enabled || !entry.enabled) {
      await replyFeedback(interaction, responseText(panel, "denied", { reason: "entrée désactivée" }))
      return true
    }
    const ctx: ApplyContext = { guild, member, panel, entry, interaction, source: "button" }
    if (panel.mode === "drop") await this.revokeEntry(ctx)
    else if (panel.mode === "verify" || panel.mode === "unique") await this.grantEntry(ctx)
    else await this.toggleEntry(ctx)
    return true
  }

  /** Retourne true si l'interaction select appartient vraiment au module. */
  async applySelect(
    guild: Guild,
    member: GuildMember,
    panel: RolePanel,
    selectedIds: string[],
    interaction: Interaction
  ): Promise<boolean> {
    const selectEntries = panel.entries.filter((item) => item.enabled && item.entryType === "select")
    if (selectEntries.length === 0) return false

    const summary: GrantSummary = { granted: [], removed: [], reasons: [] }
    const mode = panel.mode

    for (const entry of selectEntries) {
      const selected = selectedIds.includes(entry.id)
      if (mode === "verify" || mode === "unique") {
        if (!selected) continue
        await this.grantEntry({ guild, member, panel, entry, interaction, source: "select", summary })
      } else if (mode === "drop") {
        if (selected) await this.revokeEntry({ guild, member, panel, entry, interaction, source: "select", summary })
      } else {
        if (selected) await this.grantEntry({ guild, member, panel, entry, interaction, source: "select", summary })
        else await this.revokeEntry({ guild, member, panel, entry, interaction, source: "select", summary })
      }
    }

    return this.summarize(panel, summary, interaction)
  }

  private async summarize(panel: RolePanel, summary: GrantSummary, interaction: Interaction): Promise<boolean> {
    const lines: string[] = []
    if (summary.granted.length > 0) {
      lines.push(responseText(panel, "granted", { role: joinRoleNames(summary.granted, panel.language) }))
    }
    if (summary.removed.length > 0) {
      lines.push(responseText(panel, "removed", { role: joinRoleNames(summary.removed, panel.language) }))
    }
    lines.push(...summary.reasons)
    if (lines.length > 0) {
      await replyFeedback(interaction, lines.join("\n"))
    }
    return true
  }
}

async function replyFeedback(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return
  if (interaction.deferred || interaction.replied)
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined)
  else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined)
}

/** Résout un membre (cache puis fetch) — events réactions envoient souvent des partials. */
export async function resolveGuildMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  const cached = guild.members.cache.get(userId)
  if (cached) return cached
  return guild.members.fetch(userId).catch(() => null)
}