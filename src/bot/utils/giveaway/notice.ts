import { ActionRowBuilder, ButtonBuilder, ContainerBuilder, MessageFlags } from "discord.js"

export const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2

export const CONTAINER_ACCENT = 0x36373e

const EMOJI_IDS = {
  channel: "1469692104589705376",
  check: "1469692151251341425",
  cogUser: "1469692167122325577",
  disable: "1469692191298556099",
  duration: "1469692196331458704",
  loop: "1469692980586872957",
  notes: "1469692988870623369",
  party: "1469693039739146435",
  people: "1469693090280505458",
} as const

export const emoji = (key: keyof typeof EMOJI_IDS): { id: string } => ({ id: EMOJI_IDS[key] })

export const EMOJI_TAGS = {
  channel: "<:Channel:1469692104589705376>",
  check: "<:Check:1469692151251341425>",
  cogUser: "<:CogUser:1469692167122325577>",
  disable: "<:Disable:1469692191298556099>",
  duration: "<:Duration:1469692196331458704>",
  loop: "<:Loop:1469692980586872957>",
  notes: "<:Notes:1469692988870623369>",
  party: "<:Party:1469693039739146435>",
  people: "<:People:1469693090280505458>",
} as const

export function buildNoticeContainer(
  emojiKey: keyof typeof EMOJI_TAGS,
  title: string,
  body: string,
  rows: ActionRowBuilder<ButtonBuilder>[] = []
): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS[emojiKey]} 〃 ${title}`))
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
  emojiKey: keyof typeof EMOJI_TAGS,
  title: string,
  body: string,
  options: { ephemeral?: boolean; rows?: ActionRowBuilder<ButtonBuilder>[] } = {}
): { components: ContainerBuilder[]; flags: number } {
  return {
    components: buildNoticeContainer(emojiKey, title, body, options.rows ?? []),
    flags: options.ephemeral ? COMPONENTS_V2_FLAGS | MessageFlags.Ephemeral : COMPONENTS_V2_FLAGS,
  }
}
