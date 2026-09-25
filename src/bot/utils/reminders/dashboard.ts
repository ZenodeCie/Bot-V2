import {
  ActionRowBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import { appEmojiComponent, appEmojiText } from "../appEmojis.js"
import { remindersStore } from "./storage.js"
import { getOverride, getSettings, resetOverride, updateOverride } from "./settings.js"
import {
  MAX_REMINDERS_PER_USER,
  MIN_REMINDERS_PER_USER,
  RECURRENCE_LABELS,
  type ReminderRecord,
  type RemindersSettings,
  type RemindersSettingsOverride,
} from "./schema.js"
import { scheduleReminder, rescheduleReminder } from "../remindersEngine.js"
import { webhookLabel } from "./webhook.js"

/**
 * Panneau « Rappels » du hub `/config`.
 *
 * Trois réglages surchargeables par salon, plus une vue de gestion des rappels
 * du serveur. Le tout tient dans deux containers, comme le hub lui-même : le
 * premier porte la configuration, le second bascule entre la liste et la fiche
 * du rappel sélectionné.
 *
 * Les mutations passent **toujours** par le moteur : écrire dans le store sans
 * toucher aux timers laisserait un rappel supprimé armé en mémoire.
 */

export const V2_FLAGS = MessageFlags.IsComponentsV2

const PREFIX = "rmb_cfg"
const CONTAINER_ACCENT = 0x36373e
/** Le sélecteur est plafonné à 25 par Discord. */
const PICK_LIMIT = 25
/** Nombre de rappels décrits dans le texte du panneau. */
const LIST_PREVIEW = 10

const ADMIN_ONLY = `${PREFIX}_admin`
const WEBHOOK = `${PREFIX}_webhook`
const QUOTA_BTN = `${PREFIX}_quota_btn`
const QUOTA_MODAL = `${PREFIX}_quota_modal`
const RESET = `${PREFIX}_reset`
const BACK = `${PREFIX}_back`
const PICK = `${PREFIX}_pick`
const PAUSE = `${PREFIX}_pause:`
const DELETE = `${PREFIX}_delete:`

const OVERRIDABLE_KEYS: (keyof RemindersSettings)[] = [
  "adminOnly",
  "maxRemindersPerUser",
  "allowWebhookDestination",
]

function onOff(value: boolean): string {
  return value ? `${appEmojiText("power")} Activé` : `${appEmojiText("power")} Désactivé`
}

/** one-ligne les sauts de ligne : un label Discord ne doit pas en contenir. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncate(value: string, max: number): string {
  const one = oneLine(value)
  if (!one) return "Rappel sans message"
  return one.length > max ? `${one.slice(0, Math.max(1, max - 1))}…` : one
}

function provenance(settings: RemindersSettings, override: RemindersSettingsOverride): string {
  return OVERRIDABLE_KEYS.some((key) => override[key] !== undefined) ? "surcharge de ce salon" : "défauts du bot"
}

function recurrenceLabel(record: ReminderRecord): string {
  return record.recurrence === "custom" ? `cron \`${record.cronExpr}\`` : RECURRENCE_LABELS[record.recurrence]
}

function destinationLabel(record: ReminderRecord): string {
  if (record.destination === "dm") return "message privé"
  if (record.destination === "salon") return `<#${record.channelId}>`
  return webhookLabel(record.webhookId)
}

function relativeTime(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:f>`
}

function buildSettingsPanel(settings: RemindersSettings, override: RemindersSettingsOverride): ContainerBuilder {
  const panel = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  panel.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("pin")} 〃 Rappels — configuration`))
  panel.addSeparatorComponents((s) => s.setSpacing(1))
  panel.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Valeurs appliquées : ${provenance(settings, override)}.*\n` +
        `> ${appEmojiText("people")} ***Réservation :** ${onOff(settings.adminOnly)}*\n` +
        `> ${appEmojiText("pin")} ***Par utilisateur :** ${settings.maxRemindersPerUser} rappel(s) (${MIN_REMINDERS_PER_USER}–${MAX_REMINDERS_PER_USER})*\n` +
        `> ${appEmojiText("file")} ***Destination webhook :** ${onOff(settings.allowWebhookDestination)}\n\n` +
        `> *L'URL d'un webhook contient son token : elle n'est ni stockée en clair dans ce salon ni réaffichée.*`
    )
  )
  panel.addSeparatorComponents((s) => s.setDivider(true))
  panel.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) =>
        t.setContent(`**Réserver aux administrateurs**\n> ${onOff(settings.adminOnly)}\n> *Sinon, tout membre peut créer un rappel.*`)
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(ADMIN_ONLY)
          .setEmoji(appEmojiComponent("power"))
          .setStyle(settings.adminOnly ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  panel.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Destination webhook**\n> ${onOff(settings.allowWebhookDestination)}\n> *Permet le renvoi vers un webhook enregistré par l'auteur.*`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(WEBHOOK)
          .setEmoji(appEmojiComponent("power"))
          .setStyle(settings.allowWebhookDestination ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  panel.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) =>
        t.setContent(`**Quota par utilisateur**\n> \`${settings.maxRemindersPerUser}\`\n> *Entre ${MIN_REMINDERS_PER_USER} et ${MAX_REMINDERS_PER_USER}.*`)
      )
      .setButtonAccessory((btn) =>
        btn.setCustomId(QUOTA_BTN).setEmoji(appEmojiComponent("cog")).setStyle(ButtonStyle.Secondary)
      )
  )
  panel.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) => t.setContent("**Réinitialiser ce salon**\n> *Revient aux valeurs par défaut du bot.*"))
      .setButtonAccessory((btn) =>
        btn.setCustomId(RESET).setEmoji(appEmojiComponent("cancel")).setStyle(ButtonStyle.Secondary)
      )
  )
  return panel
}

function buildListPanel(records: ReminderRecord[]): ContainerBuilder {
  const panel = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  panel.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("loop")} 〃 Rappels du serveur`))
  panel.addSeparatorComponents((s) => s.setSpacing(1))
  if (records.length === 0) {
    panel.addTextDisplayComponents((t) => t.setContent("> *Aucun rappel actif ou en pause sur ce serveur.*"))
    return panel
  }
  panel.addTextDisplayComponents((t) =>
    t.setContent(
      `> *${records.length} rappel(s) — les ${Math.min(records.length, LIST_PREVIEW)} premiers sont listés.*\n` +
        records
          .slice(0, LIST_PREVIEW)
          .map(
            (record) =>
              `> ${record.paused ? "*en pause*" : "**actif**"} ${oneLine(record.message).slice(0, 60) || "*vide*"} — ` +
              `${relativeTime(record.nextAt)} — ${recurrenceLabel(record)} — ${destinationLabel(record)}`
          )
          .join("\n")
    )
  )
  panel.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(PICK)
        .setPlaceholder("Gérer un rappel...")
        .setMaxValues(1)
        .addOptions(
          records.slice(0, PICK_LIMIT).map((record) => ({
            label: truncate(record.message, 100),
            description: truncate(
              `${record.paused ? "En pause" : "Actif"} · ${oneLine(recurrenceLabel(record))} · ${relativeTime(record.nextAt)}`,
              100
            ),
            value: record.id,
          }))
        )
    )
  )
  return panel
}

function buildDetailPanel(record: ReminderRecord): ContainerBuilder {
  const panel = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  panel.addTextDisplayComponents((t) =>
    t.setContent(`# ${appEmojiText("pin")} 〃 Rappel \`${record.id}\``)
  )
  panel.addSeparatorComponents((s) => s.setSpacing(1))
  panel.addTextDisplayComponents((t) =>
    t.setContent(
      `> **Texte :** ${truncate(record.message, 300)}\n` +
        `> **Auteur :** <@${record.authorId}>\n` +
        `> **Prochain envoi :** ${relativeTime(record.nextAt)}\n` +
        `> **Récurrence :** ${recurrenceLabel(record)}\n` +
        `> **Destination :** ${destinationLabel(record)}\n` +
        `> **État :** ${record.paused ? "*en pause*" : "**actif**"}` +
        `${record.lastError ? `\n> **Dernière erreur :** ${truncate(record.lastError, 120)}` : ""}`
    )
  )
  panel.addSeparatorComponents((s) => s.setDivider(true))
  panel.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) =>
        t.setContent(record.paused ? "**Reprendre**\n> *Réarme l'envoi à la date prévue.*" : "**Suspendre**\n> *Libère le timer sans supprimer le rappel.*")
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`${PAUSE}${record.id}`)
          .setEmoji(appEmojiComponent("power"))
          .setStyle(record.paused ? ButtonStyle.Success : ButtonStyle.Danger)
      )
  )
  panel.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) => t.setContent("**Supprimer ce rappel**\n> *Action définitive.*"))
      .setButtonAccessory((btn) =>
        btn.setCustomId(`${DELETE}${record.id}`).setEmoji(appEmojiComponent("cancel")).setStyle(ButtonStyle.Danger)
      )
  )
  panel.addSectionComponents((section) =>
    section
      .addTextDisplayComponents((t) => t.setContent("**Retour à la liste**"))
      .setButtonAccessory((btn) =>
        btn.setCustomId(BACK).setEmoji(appEmojiComponent("file")).setStyle(ButtonStyle.Secondary)
      )
  )
  return panel
}

/** Deux containers : configuration, puis liste ou fiche. */
export function buildRemindersPanel(
  settings: RemindersSettings,
  override: RemindersSettingsOverride,
  records: ReminderRecord[],
  selected: ReminderRecord | null = null
): ContainerBuilder[] {
  return [buildSettingsPanel(settings, override), selected ? buildDetailPanel(selected) : buildListPanel(records)]
}

function buildQuotaModal(current: number): ModalBuilder {
  const quota = new TextInputBuilder()
    .setCustomId("quota")
    .setLabel(`Par utilisateur (${MIN_REMINDERS_PER_USER}-${MAX_REMINDERS_PER_USER})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(4)
    .setPlaceholder("10")
    .setValue(String(current))
  return new ModalBuilder()
    .setCustomId(QUOTA_MODAL)
    .setTitle("Quota de rappels")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(quota))
}

async function loadPanelData(guildId: string): Promise<{
  settings: RemindersSettings
  override: RemindersSettingsOverride
  records: ReminderRecord[]
}> {
  const [settings, override, all] = await Promise.all([
    getSettings(guildId),
    getOverride(guildId),
    remindersStore().listAll(),
  ])
  return { settings, override, records: all.filter((record) => record.guildId === guildId) }
}

/** Un submit de modale n'est pas un `MessageComponentInteraction` : on n'exige que `update`. */
type PanelUpdater = MessageComponentInteraction | { update: MessageComponentInteraction["update"]; guild: Guild | null }

async function refreshPanel(
  interaction: PanelUpdater,
  guild: Guild,
  selectedId: string | null = null
): Promise<void> {
  const { settings, override, records } = await loadPanelData(guild.id)
  const selected = selectedId ? (records.find((record) => record.id === selectedId) ?? null) : null
  await interaction.update({
    components: buildRemindersPanel(settings, override, records, selected),
    flags: V2_FLAGS,
  })
}

async function requireAdministrator(interaction: Interaction): Promise<boolean> {
  const member = interaction.member
  const permissions =
    member && typeof member.permissions === "object" && member.permissions !== null ? member.permissions : null
  if (!permissions?.has("Administrator")) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: "> *Ce panneau nécessite la permission **Administrateur**.*",
        flags: MessageFlags.Ephemeral,
      })
    }
    return false
  }
  return true
}

/** Route les `customId` du panneau. À appeler avant les handlers de commande. */
export async function handleRemindersConfigInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.inGuild()) return false
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith(`${PREFIX}_`)) return false
  if (!(await requireAdministrator(interaction))) return true

  const guild = interaction.guild
  if (!guild) return true

  if (interaction.isModalSubmit()) {
    if (customId !== QUOTA_MODAL) return false
    if (!interaction.isFromMessage()) {
      await interaction.reply({ content: "> *Panneau expiré, rouvre `/config`.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const raw = interaction.fields.getTextInputValue("quota").trim()
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
      await interaction.reply({ content: "> *Quota invalide : saisissez un nombre entier.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const clamped = Math.min(MAX_REMINDERS_PER_USER, Math.max(MIN_REMINDERS_PER_USER, parsed))
    await updateOverride(guild.id, { maxRemindersPerUser: clamped })
    if (clamped !== parsed) {
      await interaction.followUp({
        content: `> *Quota ramené à **${clamped}** (limites ${MIN_REMINDERS_PER_USER}–${MAX_REMINDERS_PER_USER}).*`,
        flags: MessageFlags.Ephemeral,
      })
    }
    await refreshPanel(interaction, guild, null)
    return true
  }

  if (!interaction.isMessageComponent()) return false

  if (customId === ADMIN_ONLY) {
    const { settings } = await loadPanelData(guild.id)
    await updateOverride(guild.id, { adminOnly: !settings.adminOnly })
    await refreshPanel(interaction, guild, null)
    return true
  }

  if (customId === WEBHOOK) {
    const { settings } = await loadPanelData(guild.id)
    await updateOverride(guild.id, { allowWebhookDestination: !settings.allowWebhookDestination })
    await refreshPanel(interaction, guild, null)
    return true
  }

  if (customId === QUOTA_BTN) {
    const { settings } = await loadPanelData(guild.id)
    await interaction.showModal(buildQuotaModal(settings.maxRemindersPerUser))
    return true
  }

  if (customId === RESET) {
    await resetOverride(guild.id)
    await refreshPanel(interaction, guild, null)
    return true
  }

  if (customId === BACK) {
    await refreshPanel(interaction, guild, null)
    return true
  }

  if (interaction.isStringSelectMenu() && customId === PICK) {
    await refreshPanel(interaction, guild, interaction.values[0] ?? null)
    return true
  }

  if (customId.startsWith(PAUSE)) {
    const id = customId.slice(PAUSE.length)
    const store = remindersStore()
    const record = await store.get(guild.id, id)
    if (!record) {
      await interaction.reply({ content: "> *Rappel introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const updated: ReminderRecord = { ...record, paused: !record.paused }
    await store.save(updated)
    // `scheduleReminder` désarme si `paused`, réarme sinon.
    scheduleReminder(client, updated)
    await refreshPanel(interaction, guild, id)
    return true
  }

  if (customId.startsWith(DELETE)) {
    const id = customId.slice(DELETE.length)
    const store = remindersStore()
    const record = await store.get(guild.id, id)
    if (!record) {
      await interaction.reply({ content: "> *Rappel introuvable.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await store.remove(guild.id, id)
    // Le rappel a disparu : on ne désarme que son timer, pas ceux du salon.
    await rescheduleReminder(client, guild.id, id)
    await refreshPanel(interaction, guild, null)
    return true
  }

  return false
}
