import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  StringSelectMenuBuilder,
  type ActionRowBuilder as ActionRowBuilderType,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
  type MessageReplyOptions,
} from "discord.js"
import { appEmojiComponent, appEmojiHeading, appEmojiOrFallback, appEmojiText, type AppEmojiName } from "../appEmojis.js"
import { requireAdministrator } from "./access.js"
import {
  appendBackButton,
  COMPONENTS_V2_FLAGS,
  configReplyPayload,
  configUpdatePayload,
  CONTAINER_ACCENT,
  type HubComponents,
} from "./components.js"
import {
  CFG_AR_SELECT,
  CFG_BACK,
  CFG_BACK_AR,
  CFG_MODULE_SELECT,
  isConfigHubCustomId,
} from "./constants.js"
import { handleGeneralInteraction } from "./panels/general.js"
import { handleModerationPanelInteraction } from "./panels/moderation.js"
import { handlePartenariatPanelInteraction } from "./panels/partenariat.js"
import {
  ANTI_RAID_PANEL_IDS,
  ANTI_RAID_PANEL_LABELS,
  type AntiRaidPanelId,
  findEntry,
  getAvailableEntries,
  isAntiRaidPanelId,
  openAntiRaidPanel,
  resolveModuleId,
  type ConfigModuleEntry,
} from "./registry.js"

function toSelectEmoji(name: AppEmojiName): { id: string } | string {
  const custom = appEmojiComponent(name)
  if (typeof custom === "object" && custom !== null && "id" in custom) return custom
  return appEmojiOrFallback(name)
}

export function buildMainHubContainer(client: Client): ContainerBuilder[] {
  const entries = getAvailableEntries(client)
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading("settings", "Configuration")))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Configurez tous les modules du bot depuis ce panneau.*\n` +
        `> *Sélectionnez un module ci-dessous pour ouvrir sa configuration.*\n\n` +
        `> ${appEmojiText("cog")} **Modules disponibles :** \`${entries.length}\``
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CFG_MODULE_SELECT)
        .setPlaceholder("Choisir un module à configurer...")
        .addOptions(
          entries.map((entry) => ({
            label: entry.label,
            description: entry.description.slice(0, 100),
            value: entry.id,
            emoji: toSelectEmoji(entry.emoji),
          }))
        )
    )
  )
  return [container]
}

export function buildAntiRaidHubContainer(client: Client): ContainerBuilder[] {
  if (!client.enabledModules.has("ModerationAvancee")) return buildMainHubContainer(client)

  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading("power", "Anti-raid")))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Protection avancée contre le spam, les raids et les abus.*\n` +
        `> *Sélectionnez une section à configurer.*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CFG_AR_SELECT)
        .setPlaceholder("Choisir une section anti-raid...")
        .addOptions(
          ANTI_RAID_PANEL_IDS.map((id) => ({
            label: ANTI_RAID_PANEL_LABELS[id],
            value: id,
            emoji: toSelectEmoji(id === "mode" ? "cog" : "power"),
          }))
        )
    )
  )
  const back = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  back.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(CFG_BACK)
        .setLabel("Retour au hub")
        .setEmoji(appEmojiComponent("file"))
        .setStyle(ButtonStyle.Secondary)
    )
  )
  return [container, back]
}

async function openModulePanel(
  client: Client,
  guild: Guild,
  entry: ConfigModuleEntry,
  backId: string
): Promise<HubComponents> {
  const panels = await entry.openPanel({ client, guild })
  return appendBackButton(panels, backId)
}

export async function buildModulePanelById(
  client: Client,
  guild: Guild,
  moduleId: string
): Promise<HubComponents | null> {
  if (moduleId === "antiraid") {
    if (!client.enabledModules.has("ModerationAvancee")) return null
    return buildAntiRaidHubContainer(client)
  }
  const entry = findEntry(moduleId)
  if (!entry) return null
  if (entry.requiredModule && !client.enabledModules.has(entry.requiredModule)) return null
  return openModulePanel(client, guild, entry, CFG_BACK)
}

export async function buildAntiRaidSectionPanel(
  client: Client,
  guild: Guild,
  panelId: AntiRaidPanelId
): Promise<HubComponents> {
  const panels = await openAntiRaidPanel(client, guild, panelId)
  return appendBackButton(panels, CFG_BACK_AR)
}

async function updateHub(interaction: MessageComponentInteraction, client: Client) {
  await interaction.update(configUpdatePayload(buildMainHubContainer(client)))
}

async function updateAntiRaidHub(interaction: MessageComponentInteraction, client: Client) {
  await interaction.update(configUpdatePayload(buildAntiRaidHubContainer(client)))
}

export async function handleConfigHubInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (await handleGeneralInteraction(client, interaction)) return true
  if (await handleModerationPanelInteraction(client, interaction)) return true
  if (await handlePartenariatPanelInteraction(client, interaction)) return true

  if (!interaction.isMessageComponent()) return false
  if (!isConfigHubCustomId(interaction.customId)) return false
  if (!interaction.inGuild()) return false
  if (!(await requireAdministrator(interaction))) return true

  const guild = interaction.guild!

  if (interaction.customId === CFG_BACK) {
    await updateHub(interaction, client)
    return true
  }

  if (interaction.customId === CFG_BACK_AR) {
    await updateAntiRaidHub(interaction, client)
    return true
  }

  if (interaction.isStringSelectMenu() && interaction.customId === CFG_MODULE_SELECT) {
    const moduleId = interaction.values[0]
    if (!moduleId) return true
    const panels = await buildModulePanelById(client, guild, moduleId)
    if (!panels) {
      await interaction.reply({ content: "> *Module indisponible.*", ephemeral: true })
      return true
    }
    await interaction.update(configUpdatePayload(panels))
    return true
  }

  if (interaction.isStringSelectMenu() && interaction.customId === CFG_AR_SELECT) {
    const panelId = interaction.values[0]
    if (!panelId || !isAntiRaidPanelId(panelId)) return true
    const panels = await buildAntiRaidSectionPanel(client, guild, panelId)
    await interaction.update(configUpdatePayload(panels))
    return true
  }

  return false
}

export async function sendConfigHub(
  client: Client,
  guild: Guild,
  reply: (payload: MessageReplyOptions) => Promise<unknown>,
  directModuleId?: string | null
): Promise<void> {
  const resolved = directModuleId ? resolveModuleId(directModuleId) : null
  if (resolved) {
    const panels = await buildModulePanelById(client, guild, resolved)
    if (panels) {
      await reply(configReplyPayload(panels))
      return
    }
  }
  await reply(configReplyPayload(buildMainHubContainer(client)))
}

export { COMPONENTS_V2_FLAGS }
