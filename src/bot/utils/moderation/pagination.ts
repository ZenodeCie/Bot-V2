import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type APIEmbed, type EmbedBuilder, type Interaction } from "discord.js"

export type NavView = "warnings" | "history" | "cases" | "blacklist"

export function navId(
  view: NavView,
  guildId: string,
  moderatorId: string,
  targetId: string,
  page: number,
  dir: "prev" | "next"
): string {
  return `modnav_${view}_${guildId}_${moderatorId}_${targetId}_${page}_${dir}`
}

export function buildNavRow(
  view: NavView,
  guildId: string,
  moderatorId: string,
  targetId: string,
  page: number,
  totalPages: number
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(navId(view, guildId, moderatorId, targetId, page, "prev"))
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(navId(view, guildId, moderatorId, targetId, page, "next"))
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  )
}

export interface PageRenderResult {
  embeds: (EmbedBuilder | APIEmbed)[]
  totalPages: number
}

export async function handlePageNav(
  interaction: Interaction,
  view: NavView,
  render: (guildId: string, targetId: string, page: number) => Promise<PageRenderResult>
): Promise<boolean> {
  if (!interaction.isButton()) return false
  const match = /^modnav_(\w+)_(\d+)_(\d+)_(\d+)_(\d+)_(prev|next)$/.exec(interaction.customId)
  if (!match || match[1] !== view) return false

  const [, , guildId, moderatorId, targetId, pageStr, dir] = match

  if (interaction.user.id !== moderatorId) {
    await interaction
      .reply({ content: "> *Cette interaction ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
      .catch(() => undefined)
    return true
  }

  try {
    const current = Number(pageStr)
    const requested = dir === "prev" ? Math.max(0, current - 1) : current + 1
    const { embeds, totalPages } = await render(guildId, targetId, requested)
    const safe = Math.min(requested, totalPages - 1)

    await interaction.update({
      embeds,
      components: [buildNavRow(view, guildId, moderatorId, targetId, safe, totalPages)],
    })
  } catch (error) {
    console.error(`Failed to paginate ${view}:`, error)
    await interaction
      .reply({ content: "> *Une erreur est survenue lors de l'affichage de la page.*", flags: MessageFlags.Ephemeral })
      .catch(() => undefined)
  }
  return true
}
