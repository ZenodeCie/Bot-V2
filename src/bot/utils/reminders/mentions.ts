import {
  ActionRowBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type Client,
  type Interaction,
  type InteractionReplyOptions,
  type MessageComponentInteraction,
} from "discord.js"
import { buildModEmbed } from "../moderation/helpers.js"
import { rescheduleReminder } from "../remindersEngine.js"
import { buildReminderContent } from "./content.js"
import { MAX_MENTIONS_PER_KIND } from "./limits.js"
import { remindersStore } from "./storage.js"
import type { ReminderRecord } from "./schema.js"

/**
 * Éditeur de mentions d'un rappel.
 *
 * L'identifiant du rappel voyage dans le `customId` : ce n'est pas un secret et
 * cela évite de garder un état en mémoire, perdu au redémarrage. Aucune URL de
 * webhook n'apparaît dans un composant.
 *
 * Budget de composants : deux menus de sélection (utilisateurs, rôles) sur une
 * seule ligne, un sélecteur d'annulation à part — chaque message reste très en
 * dessous de la limite de 40 composants.
 */

const PREFIX = "rappel_mnt"
const MAX_SELECT_OPTIONS = 25
const ADD_BATCH = 5

export const MENTION_USER_ID = `${PREFIX}_user`
export const MENTION_ROLE_ID = `${PREFIX}_role`
const CANCEL_SELECT_ID = `${PREFIX}_cancel`

function parseKey(value: string): { guildId: string; id: string } | null {
  const [guildId, id] = value.split("|")
  return guildId && id ? { guildId, id } : null
}

export function mentionSummary(record: ReminderRecord): string {
  return `${record.mentionUserIds.length}/${MAX_MENTIONS_PER_KIND} utilisateur(s) · ${record.mentionRoleIds.length}/${MAX_MENTIONS_PER_KIND} rôle(s)`
}

/** Deux menus de sélection sur une ligne, désactivés une fois la limite atteinte. */
export function buildMentionRows(record: ReminderRecord): ActionRowBuilder<RoleSelectMenuBuilder | UserSelectMenuBuilder>[] {
  const userRoom = MAX_MENTIONS_PER_KIND - record.mentionUserIds.length
  const roleRoom = MAX_MENTIONS_PER_KIND - record.mentionRoleIds.length
  return [
    new ActionRowBuilder<RoleSelectMenuBuilder | UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`${MENTION_USER_ID}|${record.guildId}|${record.id}`)
        .setPlaceholder(userRoom > 0 ? "Ajouter des utilisateurs…" : "Limite d'utilisateurs atteinte")
        .setMinValues(1)
        .setMaxValues(Math.max(1, Math.min(ADD_BATCH, userRoom)))
        .setDisabled(userRoom <= 0),
      new RoleSelectMenuBuilder()
        .setCustomId(`${MENTION_ROLE_ID}|${record.guildId}|${record.id}`)
        .setPlaceholder(roleRoom > 0 ? "Ajouter des rôles…" : "Limite de rôles atteinte")
        .setMinValues(1)
        .setMaxValues(Math.max(1, Math.min(ADD_BATCH, roleRoom)))
        .setDisabled(roleRoom <= 0)
    ),
  ]
}

export function buildCancelRow(record: ReminderRecord): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CANCEL_SELECT_ID}|${record.guildId}|${record.id}`)
      .setPlaceholder("Annuler ce rappel…")
      .addOptions({
        label: "Annuler ce rappel",
        description: record.message.slice(0, 80) || "Rappel sans message",
        value: "cancel",
      })
  )
}

function mentionEmbed(record: ReminderRecord, note: string) {
  const content = buildReminderContent(record) || "*(aucun message)*"
  return buildModEmbed(
    "people",
    `Rappel ${record.id.slice(0, 8)}`,
    [`> ${content}`, `> **Quand :** <t:${Math.floor(record.nextAt / 1000)}:f>`, `> **Mentions :** ${mentionSummary(record)}`, `> ${note}`].join(
      "\n"
    ),
    "#57F287"
  )
}

/** Ouvre l'éditeur privé : mentions en cours + sélecteur d'annulation. */
export async function showMentionEditor(
  interaction: MessageComponentInteraction,
  record: ReminderRecord,
  note = "Sélectionnez pour ajouter des mentions."
): Promise<void> {
  const payload: InteractionReplyOptions = {
    embeds: [mentionEmbed(record, note)],
    components: [...buildMentionRows(record), buildCancelRow(record)],
    flags: MessageFlags.Ephemeral,
  }
  if (interaction.replied || interaction.deferred) await interaction.followUp(payload)
  else await interaction.reply(payload)
}

/** Ajoute des mentions en gardant l'ordre et en dédupliquant. */
export function mergeMentions(current: string[], incoming: string[], limit: number): string[] {
  const out = [...current]
  for (const id of incoming) {
    // Testé avant l'ajout : sinon une liste déjà pleine débordait d'un cran.
    if (out.length >= limit) break
    if (out.includes(id)) continue
    out.push(id)
  }
  return out
}

/** Combien de rappels sont listables dans un sélecteur (limite Discord : 25). */
export function selectableReminders(records: ReminderRecord[]): ReminderRecord[] {
  return records.slice(0, MAX_SELECT_OPTIONS)
}

export async function handleMentionInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() || !interaction.isAnySelectMenu()) return false
  const parsed = parseKey(interaction.customId.split("|").slice(1).join("|"))
  if (!parsed) return false

  const { guildId, id } = parsed
  const record = await remindersStore().get(guildId, id)
  if (!record) {
    await interaction.reply({ content: "> *Ce rappel n'existe plus.*", flags: MessageFlags.Ephemeral })
    return true
  }
  if (record.authorId !== interaction.user.id) {
    await interaction.reply({ content: "> *Ce rappel ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
    return true
  }

  const store = remindersStore()

  if (interaction.customId.startsWith(MENTION_USER_ID) && interaction.isUserSelectMenu()) {
    const users = mergeMentions(record.mentionUserIds, interaction.users.map((user) => user.id), MAX_MENTIONS_PER_KIND)
    const added = users.length - record.mentionUserIds.length
    const next = { ...record, mentionUserIds: users }
    await store.save(next)
    await showMentionEditor(interaction, next, `> *${added} utilisateur(s) ajouté(s).*`)
    return true
  }

  if (interaction.customId.startsWith(MENTION_ROLE_ID) && interaction.isRoleSelectMenu()) {
    const roles = mergeMentions(record.mentionRoleIds, interaction.roles.map((role) => role.id), MAX_MENTIONS_PER_KIND)
    const added = roles.length - record.mentionRoleIds.length
    const next = { ...record, mentionRoleIds: roles }
    await store.save(next)
    await showMentionEditor(interaction, next, `> *${added} rôle(s) ajouté(s).*`)
    return true
  }

  if (interaction.customId.startsWith(CANCEL_SELECT_ID)) {
    await store.remove(guildId, id)
    await rescheduleReminder(client, guildId, id)
    await interaction.reply({ content: "> *Rappel annulé.*", flags: MessageFlags.Ephemeral })
    return true
  }

  return false
}
