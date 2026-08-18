import {
  ContainerBuilder,
  MessageFlags,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
} from "discord.js"
import {
  FIELD_LABELS,
  getConfig,
  listDuePanels,
  listEnabledPanels,
  updateConfig,
  type FieldKey,
  type InformationPanelConfig,
} from "./schema.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e
const MAX_TIMEOUT = 2_147_483_647
const SWEEP_INTERVAL = 60_000

const EMOJI_TAGS = {
  notes: "<:Notes:1469692988870623369>",
  people: "<:People:1469693090280505458>",
  enable: "<:Enable:1469692252988116992>",
  party: "<:Party:1469693039739146435>",
  cogUser: "<:CogUser:1469692167122325577>",
  duration: "<:Duration:1469692196331458704>",
  channel: "<:Channel:1469692104589705376>",
  check: "<:Check:1469692151251341425>",
} as const

const FIELD_EMOJI: Record<FieldKey, string> = {
  members: EMOJI_TAGS.people,
  online: EMOJI_TAGS.enable,
  boosts: EMOJI_TAGS.party,
  owner: EMOJI_TAGS.cogUser,
  created: EMOJI_TAGS.duration,
  channels: EMOJI_TAGS.channel,
  roles: EMOJI_TAGS.check,
}

export type PublishResult = { ok: true; config: InformationPanelConfig } | { ok: false; error: string }

const timers = new Map<string, NodeJS.Timeout>()
let sweepStarted = false

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

async function resolveTextChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null
  return channel
}

function onlineCount(guild: Guild): number {
  return guild.members.cache.filter((member) => {
    const status = member.presence?.status
    return Boolean(status) && status !== "offline"
  }).size
}

async function buildFieldLines(guild: Guild, config: InformationPanelConfig): Promise<string[]> {
  const lines: string[] = []
  if (config.fields.members) {
    lines.push(`> ${FIELD_EMOJI.members} **${FIELD_LABELS.members} :** \`${guild.memberCount}\``)
  }
  if (config.fields.online) {
    lines.push(`> ${FIELD_EMOJI.online} **${FIELD_LABELS.online} :** \`${onlineCount(guild)}\``)
  }
  if (config.fields.boosts) {
    lines.push(`> ${FIELD_EMOJI.boosts} **${FIELD_LABELS.boosts} :** \`${guild.premiumSubscriptionCount ?? 0}\``)
  }
  if (config.fields.owner) {
    const owner = await guild.fetchOwner().catch(() => null)
    lines.push(
      owner
        ? `> ${FIELD_EMOJI.owner} **${FIELD_LABELS.owner} :** <@${owner.id}>`
        : `> ${FIELD_EMOJI.owner} **${FIELD_LABELS.owner} :** *Inconnu*`
    )
  }
  if (config.fields.created) {
    lines.push(`> ${FIELD_EMOJI.created} **${FIELD_LABELS.created} :** <t:${Math.floor(guild.createdTimestamp / 1000)}:D>`)
  }
  if (config.fields.channels) {
    lines.push(`> ${FIELD_EMOJI.channels} **${FIELD_LABELS.channels} :** \`${guild.channels.cache.size}\``)
  }
  if (config.fields.roles) {
    lines.push(`> ${FIELD_EMOJI.roles} **${FIELD_LABELS.roles} :** \`${Math.max(0, guild.roles.cache.size - 1)}\``)
  }
  return lines
}

export async function buildPublicContainer(guild: Guild, config: InformationPanelConfig): Promise<ContainerBuilder[]> {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  const title = clip(config.title.trim() || guild.name, 256)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.notes} 〃 ${title}`))
  container.addSeparatorComponents((s) => s.setSpacing(1))

  const blocks: string[] = []
  if (config.description.trim()) {
    blocks.push(`> *${clip(config.description.trim(), 1000)}*`)
  }
  const fields = await buildFieldLines(guild, config)
  if (fields.length > 0) {
    if (blocks.length > 0) blocks.push("")
    blocks.push(fields.join("\n"))
  } else if (blocks.length === 0) {
    blocks.push("> *Aucune information n'est affichée. Activez des champs dans le panneau.*")
  }
  container.addTextDisplayComponents((t) => t.setContent(blocks.join("\n")))
  return [container]
}

function clearTimer(guildId: string): void {
  const timer = timers.get(guildId)
  if (!timer) return
  clearTimeout(timer)
  timers.delete(guildId)
}

export function scheduleInformationPanel(client: Client, guildId: string, nextAt: number | null): void {
  clearTimer(guildId)
  if (nextAt === null) return
  const delay = nextAt - Date.now()
  if (delay <= 0) {
    void publishPanel(client, guildId).catch((error) => console.error(`Failed to publish information panel ${guildId}:`, error))
    return
  }
  const timer = setTimeout(() => {
    timers.delete(guildId)
    if (Date.now() < nextAt) {
      scheduleInformationPanel(client, guildId, nextAt)
      return
    }
    void publishPanel(client, guildId).catch((error) => console.error(`Failed to publish information panel ${guildId}:`, error))
  }, Math.min(delay, MAX_TIMEOUT))
  timers.set(guildId, timer)
}

export async function rescheduleInformationPanel(client: Client, guildId: string): Promise<void> {
  const config = await getConfig(guildId)
  if (!config.enabled || !config.channelId) {
    clearTimer(guildId)
    return
  }
  scheduleInformationPanel(client, guildId, config.nextAt ?? Date.now())
}

export async function publishPanel(client: Client, guildId: string): Promise<PublishResult> {
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
          console.error(`Failed to edit information panel in guild ${guildId}:`, error)
          return null
        })
      if (!edited) {
        return { ok: false, error: "> *Impossible de mettre à jour le panneau. Vérifiez les permissions du bot.*" }
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
        console.error(`Failed to send information panel in guild ${guildId}:`, error)
        return null
      })
    if (!sent) {
      return { ok: false, error: "> *Impossible d'envoyer le panneau dans ce salon. Vérifiez les permissions du bot.*" }
    }
    messageId = sent.id
  }

  const nextAt = Date.now() + config.interval
  const updated = await updateConfig(guildId, { $set: { messageId, nextAt } })
  if (updated.enabled && updated.channelId) {
    scheduleInformationPanel(client, guildId, nextAt)
  } else {
    clearTimer(guildId)
  }
  return { ok: true, config: updated }
}

export async function initInformationPanels(client: Client): Promise<void> {
  const panels = await listEnabledPanels()
  let overdue = 0
  for (const panel of panels) {
    scheduleInformationPanel(client, panel.guildId, panel.nextAt ?? Date.now())
    if (!panel.nextAt || panel.nextAt <= Date.now()) overdue++
  }
  console.log(`InformationPanel: ${panels.length} panneau(x) restauré(s) après redémarrage (${overdue} à actualiser).`)
}

export function startInformationPanelSweep(client: Client): void {
  if (sweepStarted) return
  sweepStarted = true
  setInterval(() => {
    void sweepDuePanels(client).catch((error) => console.error("InformationPanel sweep failed:", error))
  }, SWEEP_INTERVAL)
}

export async function sweepDuePanels(client: Client): Promise<void> {
  const due = await listDuePanels()
  for (const panel of due) {
    await publishPanel(client, panel.guildId).catch((error) => console.error(error))
  }
}
