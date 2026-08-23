import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  type ActionRowBuilder as ActionRowBuilderType,
  type InteractionUpdateOptions,
  type MessageReplyOptions,
} from "discord.js"
import { appEmojiComponent } from "../appEmojis.js"
import { COMPONENTS_V2_FLAGS, CONTAINER_ACCENT } from "../giveaway/notice.js"

export type HubComponents = Array<ContainerBuilder | ActionRowBuilderType<ButtonBuilder>>

export function appendBackButton(containers: HubComponents, backId: string): HubComponents {
  const back = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  back.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(backId)
        .setLabel("Retour")
        .setEmoji(appEmojiComponent("file"))
        .setStyle(ButtonStyle.Secondary)
    )
  )
  return [...containers, back]
}

export function configReplyPayload(components: HubComponents): MessageReplyOptions {
  return { components, flags: COMPONENTS_V2_FLAGS }
}

export function configUpdatePayload(components: HubComponents): InteractionUpdateOptions {
  return { components, flags: COMPONENTS_V2_FLAGS }
}

export { COMPONENTS_V2_FLAGS, CONTAINER_ACCENT }
