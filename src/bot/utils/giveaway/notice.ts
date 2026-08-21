import { ActionRowBuilder, ButtonBuilder, ContainerBuilder, MessageFlags } from "discord.js"
import { appEmojiHeading, type AppEmojiName } from "../appEmojis.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2

export const CONTAINER_ACCENT = 0x36373e

export function buildNoticeContainer(
  emojiKey: AppEmojiName,
  title: string,
  body: string,
  rows: ActionRowBuilder<ButtonBuilder>[] = []
): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading(emojiKey, title)))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  if (body) {
    container.addTextDisplayComponents((t) => t.setContent(body))
  }
  if (rows.length > 0) {
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addActionRowComponents(...rows)
  }
  return [container]
}

export function noticePayload(
  emojiKey: AppEmojiName,
  title: string,
  body: string,
  options: { ephemeral?: boolean; rows?: ActionRowBuilder<ButtonBuilder>[] } = {}
): { components: ContainerBuilder[]; flags: number } {
  return {
    components: buildNoticeContainer(emojiKey, title, body, options.rows ?? []),
    flags: options.ephemeral ? COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral : COMPONENTS_V2_FLAGS,
  }
}
