import { MessageFlags, type Interaction, type Message } from "discord.js"
import { HUB_PREFIX } from "./constants.js"

function walkComponentCustomIds(components: readonly unknown[] | undefined): string[] {
  if (!components?.length) return []
  const ids: string[] = []
  for (const component of components) {
    if (!component || typeof component !== "object") continue
    const record = component as Record<string, unknown>
    if (typeof record.customId === "string") ids.push(record.customId)
    if (typeof record.custom_id === "string") ids.push(record.custom_id)
    const accessory = record.accessory
    if (accessory && typeof accessory === "object") {
      const acc = accessory as Record<string, unknown>
      if (typeof acc.customId === "string") ids.push(acc.customId)
      if (typeof acc.custom_id === "string") ids.push(acc.custom_id)
    }
    for (const key of ["components", "data"]) {
      const nested = record[key]
      if (Array.isArray(nested)) ids.push(...walkComponentCustomIds(nested))
    }
  }
  return ids
}

export function messageHasConfigHubMarker(message: Pick<Message, "components">): boolean {
  return walkComponentCustomIds(message.components as readonly unknown[]).some((id) => id.startsWith(HUB_PREFIX))
}

function interactionMessage(interaction: Interaction): Message | null {
  if (interaction.isMessageComponent()) return interaction.message
  if (interaction.isModalSubmit() && interaction.isFromMessage()) return interaction.message
  return null
}

export async function requireAdministrator(interaction: Interaction): Promise<boolean> {
  const member = interaction.member
  const perms = member && typeof member.permissions === "object" && member.permissions !== null ? member.permissions : null
  if (!member || !perms?.has("Administrator")) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: "> *Cette action nécessite la permission **Administrateur**.*",
        flags: MessageFlags.Ephemeral,
      })
    }
    return false
  }
  return true
}

export async function guardConfigHubInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.inGuild()) return false
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const message = interactionMessage(interaction)
  if (!message) return false
  if (!messageHasConfigHubMarker(message)) return false
  return !(await requireAdministrator(interaction))
}
