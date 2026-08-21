import { randomInt } from "node:crypto"
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  type Client,
  type GuildTextBasedChannel,
  type Interaction,
} from "discord.js"
import {
  Giveaway,
  clampDuration,
  clampPrize,
  clampWinners,
  getGiveaway,
  listActiveGiveawaysAll,
  listDueGiveaways,
  normalizeGiveaway,
  type GiveawayRecord,
} from "./schema.js"
import { noticePayload } from "./notice.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e
const MAX_TIMEOUT = 2_147_483_647
const SWEEP_INTERVAL = 60_000
const EDIT_DEBOUNCE = 3_000

const EMOJI_IDS = {
  check: "1469692151251341425",
  disable: "1469692191298556099",
  party: "1469693039739146435",
  people: "1469693090280505458",
} as const

const EMOJI_TAGS = {
  check: "<:Check:1469692151251341425>",
  disable: "<:Disable:1469692191298556099>",
  duration: "<:Duration:1469692196331458704>",
  party: "<:Party:1469693039739146435>",
  people: "<:People:1469693090280505458>",
  cogUser: "<:CogUser:1469692167122325577>",
} as const

export type GiveawayActionResult =
  | { ok: true; giveaway: GiveawayRecord }
  | { ok: false; error: string }

export interface StartGiveawayInput {
  client: Client
  guildId: string
  channel: GuildTextBasedChannel
  hostId: string
  prize: string
  duration: number
  winnerCount: number
  requiredRoleId: string | null
}

const timers = new Map<string, NodeJS.Timeout>()
const pendingEdits = new Map<string, NodeJS.Timeout>()
let sweepStarted = false

function unix(ms: number): number {
  return Math.floor(ms / 1000)
}

function mentionUsers(ids: string[]): string {
  return ids.map((id) => `<@${id}>`).join(", ")
}

export function pickWinners(participantIds: string[], count: number): string[] {
  const pool = [...new Set(participantIds)]
  if (pool.length === 0 || count <= 0) return []
  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(pool.length - i)
    const current = pool[i]
    const swap = pool[j]
    if (current === undefined || swap === undefined) break
    pool[i] = swap
    pool[j] = current
  }
  return pool.slice(0, n)
}

export function buildGiveawayComponents(giveaway: GiveawayRecord): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  const ended = giveaway.ended || giveaway.cancelled
  const participantCount = giveaway.participants.length

  if (giveaway.cancelled) {
    container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.disable} 〃 Giveaway annulé`))
  } else if (giveaway.ended) {
    container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.check} 〃 Giveaway terminé`))
  } else {
    container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.party} 〃 Giveaway`))
  }

  container.addSeparatorComponents((s) => s.setSpacing(1))

  const lines = [
    `> ***Prix :** ${giveaway.prize}*`,
    `> ${EMOJI_TAGS.people} ***Gagnants :** \`${giveaway.winnerCount}\`*`,
    `> ${EMOJI_TAGS.cogUser} ***Hôte :** <@${giveaway.hostId}>*`,
  ]
  if (giveaway.requiredRoleId) {
    lines.push(`> ${EMOJI_TAGS.people} ***Rôle requis :** <@&${giveaway.requiredRoleId}>*`)
  }
  if (giveaway.cancelled) {
    lines.push(`> ${EMOJI_TAGS.disable} ***Statut :** Annulé*`)
  } else if (giveaway.ended) {
    lines.push(
      giveaway.winners.length > 0
        ? `> ${EMOJI_TAGS.party} ***Gagnant${giveaway.winners.length > 1 ? "s" : ""} :** ${mentionUsers(giveaway.winners)}*`
        : `> ${EMOJI_TAGS.disable} ***Gagnants :** Aucun participant*`
    )
    lines.push(`> ${EMOJI_TAGS.people} ***Participants :** \`${participantCount}\`*`)
  } else {
    lines.push(
      `> ${EMOJI_TAGS.duration} ***Fin :** <t:${unix(giveaway.endsAt)}:F> (<t:${unix(giveaway.endsAt)}:R>)*`
    )
    lines.push(`> ${EMOJI_TAGS.people} ***Participants :** \`${participantCount}\`*`)
  }

  container.addTextDisplayComponents((t) => t.setContent(lines.join("\n")))
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`gw_enter:${giveaway.id}`)
        .setLabel(
          ended
            ? giveaway.cancelled
              ? "Annulé"
              : "Terminé"
            : `Participer (${participantCount})`.slice(0, 80)
        )
        .setEmoji({ id: ended ? EMOJI_IDS.disable : EMOJI_IDS.party })
        .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(ended)
    )
  )
  return [container]
}

async function resolveTextChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null
  return channel
}

async function editGiveawayMessage(client: Client, giveaway: GiveawayRecord): Promise<void> {
  if (!giveaway.messageId) return
  const channel = await resolveTextChannel(client, giveaway.channelId)
  if (!channel) return
  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null)
  if (!message) return
  await message
    .edit({
      components: buildGiveawayComponents(giveaway),
      flags: COMPONENTS_V2_FLAGS,
      allowedMentions: { parse: [] },
    })
    .catch((error) => {
      console.error(`Failed to edit giveaway ${giveaway.id} in ${giveaway.guildId}:`, error)
    })
}

function clearEditDebounce(id: string): void {
  const timer = pendingEdits.get(id)
  if (!timer) return
  clearTimeout(timer)
  pendingEdits.delete(id)
}

function scheduleMessageRefresh(client: Client, id: string): void {
  clearEditDebounce(id)
  const timer = setTimeout(() => {
    pendingEdits.delete(id)
    void (async () => {
      const giveaway = await getGiveaway(id)
      if (!giveaway || giveaway.ended || giveaway.cancelled) return
      await editGiveawayMessage(client, giveaway)
    })().catch((error) => console.error(`Failed to refresh giveaway ${id}:`, error))
  }, EDIT_DEBOUNCE)
  timer.unref()
  pendingEdits.set(id, timer)
}

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (!timer) return
  clearTimeout(timer)
  timers.delete(id)
}

export function scheduleGiveaway(client: Client, id: string, endsAt: number): void {
  clearTimer(id)
  const delay = endsAt - Date.now()
  if (delay <= 0) {
    void endGiveaway(client, id).catch((error) => console.error(`Failed to end giveaway ${id}:`, error))
    return
  }
  const timer = setTimeout(() => {
    timers.delete(id)
    if (Date.now() < endsAt) {
      scheduleGiveaway(client, id, endsAt)
      return
    }
    void endGiveaway(client, id).catch((error) => console.error(`Failed to end giveaway ${id}:`, error))
  }, Math.min(delay, MAX_TIMEOUT))
  timers.set(id, timer)
}

async function announceWinners(
  client: Client,
  giveaway: GiveawayRecord,
  kind: "end" | "reroll"
): Promise<void> {
  const channel = await resolveTextChannel(client, giveaway.channelId)
  if (!channel) return
  const content =
    giveaway.winners.length > 0
      ? kind === "reroll"
        ? `> *Nouveau${giveaway.winners.length > 1 ? "x" : ""} gagnant${giveaway.winners.length > 1 ? "s" : ""} : ${mentionUsers(giveaway.winners)} ! Vous gagnez **${giveaway.prize}**.*`
        : `> *Félicitations ${mentionUsers(giveaway.winners)} ! Vous gagnez **${giveaway.prize}**.*`
      : `> *Aucun participant. Giveaway **${giveaway.prize}** clôturé sans gagnant.*`
  await channel
    .send({
      content,
      allowedMentions: { parse: [], users: giveaway.winners },
    })
    .catch((error) => {
      console.error(`Failed to announce giveaway ${giveaway.id}:`, error)
    })
}

export async function startGiveaway(input: StartGiveawayInput): Promise<GiveawayActionResult> {
  const prize = clampPrize(input.prize)
  if (!prize) return { ok: false, error: "> *Indiquez un prix.*" }
  const duration = clampDuration(input.duration)
  const winnerCount = clampWinners(input.winnerCount)
  const now = Date.now()
  const endsAt = now + duration

  const created = await Giveaway.create({
    guildId: input.guildId,
    channelId: input.channel.id,
    messageId: "",
    prize,
    winnerCount,
    hostId: input.hostId,
    requiredRoleId: input.requiredRoleId,
    participants: [],
    winners: [],
    startsAt: now,
    endsAt,
    ended: false,
    cancelled: false,
    endedAt: null,
  })

  const draft = normalizeGiveaway(created.toObject() as Record<string, unknown>)
  if (!draft) {
    await Giveaway.deleteOne({ _id: created._id }).catch(() => undefined)
    return { ok: false, error: "> *Impossible de créer le giveaway.*" }
  }

  const sent = await input.channel
    .send({
      components: buildGiveawayComponents(draft),
      flags: COMPONENTS_V2_FLAGS,
      allowedMentions: { parse: [] },
    })
    .catch((error: unknown) => {
      console.error(`Failed to send giveaway in guild ${input.guildId}:`, error)
      return null
    })

  if (!sent) {
    await Giveaway.deleteOne({ _id: created._id }).catch(() => undefined)
    return { ok: false, error: "> *Impossible d'envoyer le giveaway dans ce salon. Vérifiez les permissions du bot.*" }
  }

  await Giveaway.updateOne({ _id: created._id }, { $set: { messageId: sent.id } })
  const giveaway: GiveawayRecord = { ...draft, messageId: sent.id }
  scheduleGiveaway(input.client, giveaway.id, giveaway.endsAt)
  return { ok: true, giveaway }
}

export async function endGiveaway(client: Client, id: string): Promise<GiveawayActionResult> {
  const current = await getGiveaway(id)
  if (!current) return { ok: false, error: "> *Giveaway introuvable.*" }
  if (current.cancelled) return { ok: false, error: "> *Ce giveaway a été annulé.*" }
  if (current.ended) return { ok: false, error: "> *Ce giveaway est déjà terminé.*" }

  const winners = pickWinners(current.participants, current.winnerCount)
  const reserved = await Giveaway.findOneAndUpdate(
    { _id: id, ended: false, cancelled: false },
    { $set: { ended: true, endedAt: Date.now(), winners } },
    { new: true }
  ).lean()
  const giveaway = normalizeGiveaway(reserved as Record<string, unknown> | null)
  if (!giveaway) return { ok: false, error: "> *Ce giveaway est déjà terminé.*" }

  clearTimer(id)
  clearEditDebounce(id)
  await editGiveawayMessage(client, giveaway)
  await announceWinners(client, giveaway, "end")
  return { ok: true, giveaway }
}

export async function rerollGiveaway(client: Client, id: string): Promise<GiveawayActionResult> {
  const current = await getGiveaway(id)
  if (!current) return { ok: false, error: "> *Giveaway introuvable.*" }
  if (current.cancelled) return { ok: false, error: "> *Ce giveaway a été annulé.*" }
  if (!current.ended) return { ok: false, error: "> *Ce giveaway n'est pas encore terminé.*" }

  const excluded = new Set(current.winners)
  const pool = current.participants.filter((userId) => !excluded.has(userId))
  const winners = pickWinners(pool, current.winnerCount)
  if (winners.length === 0) {
    return { ok: false, error: "> *Aucun participant restant pour un nouveau tirage.*" }
  }

  const updated = await Giveaway.findOneAndUpdate(
    { _id: id, ended: true, cancelled: false },
    { $set: { winners, endedAt: Date.now() } },
    { new: true }
  ).lean()
  const giveaway = normalizeGiveaway(updated as Record<string, unknown> | null)
  if (!giveaway) return { ok: false, error: "> *Impossible de relancer ce giveaway.*" }

  await editGiveawayMessage(client, giveaway)
  await announceWinners(client, giveaway, "reroll")
  return { ok: true, giveaway }
}

export async function cancelGiveaway(client: Client, id: string): Promise<GiveawayActionResult> {
  const reserved = await Giveaway.findOneAndUpdate(
    { _id: id, ended: false, cancelled: false },
    { $set: { cancelled: true, ended: true, endedAt: Date.now() } },
    { new: true }
  ).lean()
  const giveaway = normalizeGiveaway(reserved as Record<string, unknown> | null)
  if (!giveaway) {
    const existing = await getGiveaway(id)
    if (!existing) return { ok: false, error: "> *Giveaway introuvable.*" }
    if (existing.cancelled) return { ok: false, error: "> *Ce giveaway est déjà annulé.*" }
    return { ok: false, error: "> *Ce giveaway est déjà terminé.*" }
  }

  clearTimer(id)
  clearEditDebounce(id)
  await editGiveawayMessage(client, giveaway)
  return { ok: true, giveaway }
}

export async function handleEnterInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.inGuild() || !interaction.guild) return false
  if (!interaction.customId.startsWith("gw_enter:")) return false

  const id = interaction.customId.slice("gw_enter:".length)
  const giveaway = await getGiveaway(id)
  if (!giveaway || giveaway.guildId !== interaction.guild.id) {
    await interaction.reply(
      noticePayload("disable", "Giveaway indisponible", "> *Ce giveaway n'est plus disponible.*", { ephemeral: true })
    )
    return true
  }
  if (giveaway.cancelled || giveaway.ended) {
    await interaction.reply(
      noticePayload(
        "disable",
        "Giveaway indisponible",
        giveaway.cancelled ? "> *Ce giveaway a été annulé.*" : "> *Ce giveaway est terminé.*",
        { ephemeral: true }
      )
    )
    return true
  }
  if (interaction.user.bot) {
    await interaction.reply(noticePayload("disable", "Participation refusée", "> *Les bots ne peuvent pas participer.*", { ephemeral: true }))
    return true
  }

  const member =
    interaction.guild.members.cache.get(interaction.user.id) ??
    (await interaction.guild.members.fetch(interaction.user.id).catch(() => null))
  if (!member) {
    await interaction.reply(noticePayload("disable", "Erreur", "> *Membre introuvable.*", { ephemeral: true }))
    return true
  }
  if (giveaway.requiredRoleId && !member.roles.cache.has(giveaway.requiredRoleId)) {
    await interaction.reply(
      noticePayload(
        "disable",
        "Rôle requis",
        `> *Vous devez avoir le rôle <@&${giveaway.requiredRoleId}> pour participer.*`,
        { ephemeral: true }
      )
    )
    return true
  }

  const userId = interaction.user.id
  const added = await Giveaway.findOneAndUpdate(
    { _id: id, ended: false, cancelled: false, participants: { $ne: userId } },
    { $addToSet: { participants: userId } },
    { new: true }
  ).lean()

  if (added) {
    scheduleMessageRefresh(client, id)
    await interaction.reply(
      noticePayload("party", "Participation confirmée", `> *Vous participez au giveaway **${giveaway.prize}**.*`, {
        ephemeral: true,
      })
    )
    return true
  }

  const removed = await Giveaway.findOneAndUpdate(
    { _id: id, ended: false, cancelled: false, participants: userId },
    { $pull: { participants: userId } },
    { new: true }
  ).lean()

  if (removed) {
    scheduleMessageRefresh(client, id)
    await interaction.reply(
      noticePayload("disable", "Participation retirée", `> *Vous ne participez plus au giveaway **${giveaway.prize}**.*`, {
        ephemeral: true,
      })
    )
    return true
  }

  await interaction.reply(
    noticePayload("disable", "Giveaway indisponible", "> *Ce giveaway n'est plus disponible.*", { ephemeral: true })
  )
  return true
}

export async function initGiveaways(client: Client): Promise<void> {
  const active = await listActiveGiveawaysAll()
  let overdue = 0
  let orphans = 0
  for (const giveaway of active) {
    if (!giveaway.messageId) {
      await Giveaway.updateOne(
        { _id: giveaway.id, ended: false, cancelled: false },
        { $set: { cancelled: true, ended: true, endedAt: Date.now() } }
      ).catch(() => undefined)
      orphans++
      continue
    }
    scheduleGiveaway(client, giveaway.id, giveaway.endsAt)
    if (giveaway.endsAt <= Date.now()) overdue++
  }
  console.log(
    `Giveaway: ${active.length} giveaway(s) restauré(s) après redémarrage (${overdue} déjà expiré(s), ${orphans} orphelin(s)).`
  )
}

export function startGiveawaySweep(client: Client): void {
  if (sweepStarted) return
  sweepStarted = true
  setInterval(() => {
    void sweepExpiredGiveaways(client).catch((error) => console.error("Giveaway sweep failed:", error))
  }, SWEEP_INTERVAL)
}

export async function sweepExpiredGiveaways(client: Client): Promise<void> {
  const expired = await listDueGiveaways()
  for (const giveaway of expired) {
    await endGiveaway(client, giveaway.id).catch((error) => console.error(error))
  }
}

