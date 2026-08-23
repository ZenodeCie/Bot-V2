import type { Client, Guild, PermissionResolvable } from "discord.js"
import type { HubComponents } from "./components.js"
import type { AppEmojiName } from "../../../shared/botConfig.js"
import {
  buildHoneypotContainer,
  buildLockdownContainer,
  buildLogsContainer,
  buildModeContainer,
  buildModuleContainer,
  buildQuarantineContainer,
  buildWhitelistContainer,
} from "../antiraid/dashboard.js"
import { MODULE_LABELS, MODULES, getConfig as getAntiRaidConfig, type ModuleName } from "../antiraid/schema.js"
import { buildAeroportContainer } from "../aeroport/dashboard.js"
import { getConfig as getAeroportConfig } from "../aeroport/schema.js"
import { buildCaptchaContainer } from "../captcha/dashboard.js"
import { getConfig as getCaptchaConfig } from "../captcha/schema.js"
import { buildGiveawayContainer } from "../giveaway/dashboard.js"
import { getConfig as getGiveawayConfig, listActiveGiveaways } from "../giveaway/schema.js"
import { buildInformationPanelContainer } from "../informationpanel/dashboard.js"
import { getConfig as getInformationPanelConfig } from "../informationpanel/schema.js"
import { buildInvitationsContainer } from "../invitations/dashboard.js"
import { getConfig as getInvitationsConfig } from "../invitations/schema.js"
import { buildLevelsContainer } from "../levels/dashboard.js"
import { getConfig as getLevelsConfig } from "../levels/schema.js"
import { buildGuildLogsContainer } from "../logs/dashboard.js"
import { getConfig as getLogsConfig } from "../logs/schema.js"
import { buildMessageHoraireContainer } from "../message-horaire/dashboard.js"
import { getConfig as getMessageHoraireConfig, listJobs } from "../message-horaire/schema.js"
import { buildRulesContainer } from "../rules/dashboard.js"
import { getConfig as getRulesConfig } from "../rules/schema.js"
import { buildStaffListContainer } from "../stafflist/dashboard.js"
import { getConfig as getStaffListConfig } from "../stafflist/schema.js"
import { buildTicketsPayload } from "../tickets/dashboard.js"
import { getConfig as getTicketsConfig } from "../tickets/schema.js"
import { buildGeneralContainer } from "./panels/general.js"
import { buildBlacklistContainer, buildModlogContainer } from "./panels/moderation.js"

export interface ConfigOpenContext {
  client: Client
  guild: Guild
}

export type ConfigPanelComponents = HubComponents

export interface ConfigModuleEntry {
  id: string
  label: string
  emoji: AppEmojiName
  description: string
  requiredModule?: string
  permission?: PermissionResolvable
  aliases?: string[]
  openPanel: (ctx: ConfigOpenContext) => Promise<ConfigPanelComponents>
}

export const MODULE_ID_ALIASES: Record<string, string> = {
  general: "general",
  prefix: "general",
  captcha: "captcha",
  logs: "logs",
  serverlogs: "logs",
  levels: "levels",
  niveaux: "levels",
  rules: "rules",
  reglement: "rules",
  stafflist: "stafflist",
  staff: "stafflist",
  invitations: "invitations",
  invites: "invitations",
  giveaway: "giveaway",
  gw: "giveaway",
  aeroport: "aeroport",
  airport: "aeroport",
  welcome: "aeroport",
  infopanel: "infopanel",
  informationpanel: "infopanel",
  "message-horaire": "message-horaire",
  horaire: "message-horaire",
  tickets: "tickets",
  ticket: "tickets",
  modlog: "moderation-modlog",
  moderation: "moderation-modlog",
  blacklist: "moderation-blacklist",
  antiraid: "antiraid",
  "anti-raid": "antiraid",
}

export const ANTI_RAID_PANEL_IDS = [
  "mode",
  ...MODULES,
  "whitelist",
  "honeypot",
  "quarantine",
  "lockdown",
  "logs",
] as const

export type AntiRaidPanelId = (typeof ANTI_RAID_PANEL_IDS)[number]

export const ANTI_RAID_PANEL_LABELS: Record<AntiRaidPanelId, string> = {
  mode: "Mode global",
  ...MODULE_LABELS,
  whitelist: "Liste blanche",
  honeypot: "Honeypot",
  quarantine: "Quarantaine",
  lockdown: "Verrouillage (lockdown)",
  logs: "Logs anti-raid",
}

const ALL_ENTRIES: ConfigModuleEntry[] = [
  {
    id: "general",
    label: "Général",
    emoji: "cog",
    description: "Préfixe et réglages de base",
    requiredModule: "Base",
    permission: "Administrator",
    aliases: ["prefix"],
    openPanel: ({ client, guild }) => buildGeneralContainer(client, guild),
  },
  {
    id: "captcha",
    label: "Captcha",
    emoji: "check",
    description: "Vérification anti-bot à l'arrivée",
    requiredModule: "Captcha",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getCaptchaConfig(guild.id)
      return buildCaptchaContainer(client, guild, cfg)
    },
  },
  {
    id: "logs",
    label: "Logs",
    emoji: "file",
    description: "Journal des événements du serveur",
    requiredModule: "Logs",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getLogsConfig(guild.id)
      return buildGuildLogsContainer(client, guild, cfg)
    },
  },
  {
    id: "levels",
    label: "Niveaux",
    emoji: "people",
    description: "XP et classement des membres",
    requiredModule: "Levels",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getLevelsConfig(guild.id)
      return buildLevelsContainer(client, guild, cfg)
    },
  },
  {
    id: "rules",
    label: "Règlement",
    emoji: "file",
    description: "Règlement interactif",
    requiredModule: "Rules",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getRulesConfig(guild.id)
      return buildRulesContainer(client, guild, cfg)
    },
  },
  {
    id: "stafflist",
    label: "Liste du staff",
    emoji: "people",
    description: "Affichage automatique du staff",
    requiredModule: "StaffList",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getStaffListConfig(guild.id)
      return buildStaffListContainer(client, guild, cfg)
    },
  },
  {
    id: "invitations",
    label: "Invitations",
    emoji: "people",
    description: "Suivi des invitations",
    requiredModule: "Invitations",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getInvitationsConfig(guild.id)
      return buildInvitationsContainer(client, guild, cfg)
    },
  },
  {
    id: "giveaway",
    label: "Giveaway",
    emoji: "add",
    description: "Giveaways et tirages au sort",
    requiredModule: "Giveaway",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const [cfg, active] = await Promise.all([getGiveawayConfig(guild.id), listActiveGiveaways(guild.id)])
      return buildGiveawayContainer(client, guild, cfg, active)
    },
  },
  {
    id: "aeroport",
    label: "Aéroport",
    emoji: "people",
    description: "Messages d'arrivée et de départ",
    requiredModule: "Aeroport",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getAeroportConfig(guild.id)
      return buildAeroportContainer(client, guild, cfg)
    },
  },
  {
    id: "infopanel",
    label: "Panneau d'information",
    emoji: "pin",
    description: "Informations utiles du serveur",
    requiredModule: "InformationPanel",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getInformationPanelConfig(guild.id)
      return buildInformationPanelContainer(client, guild, cfg)
    },
  },
  {
    id: "message-horaire",
    label: "Messages horaires",
    emoji: "loop",
    description: "Messages programmés récurrents",
    requiredModule: "Message-Horaire",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const [cfg, jobs] = await Promise.all([getMessageHoraireConfig(guild.id), listJobs(guild.id)])
      return buildMessageHoraireContainer(client, guild, cfg, jobs)
    },
  },
  {
    id: "tickets",
    label: "Tickets",
    emoji: "file",
    description: "Système de tickets",
    requiredModule: "Tickets",
    permission: "ManageGuild",
    openPanel: async ({ client, guild }) => {
      const cfg = await getTicketsConfig(guild.id)
      return buildTicketsPayload(client, guild, cfg) as HubComponents
    },
  },
  {
    id: "moderation-modlog",
    label: "Logs de modération",
    emoji: "file",
    description: "Salon des actions de modération",
    requiredModule: "Moderation",
    permission: "ManageGuild",
    openPanel: ({ client, guild }) => buildModlogContainer(client, guild),
  },
  {
    id: "moderation-blacklist",
    label: "Liste noire",
    emoji: "cancel",
    description: "Sanctions automatiques à l'arrivée",
    requiredModule: "Moderation",
    permission: "ManageGuild",
    openPanel: ({ client, guild }) => buildBlacklistContainer(client, guild),
  },
  {
    id: "antiraid",
    label: "Anti-raid",
    emoji: "power",
    description: "Protection anti-spam et anti-raid",
    requiredModule: "ModerationAvancee",
    permission: "Administrator",
    openPanel: async () => [],
  },
]

export function getAvailableEntries(client: Client): ConfigModuleEntry[] {
  return ALL_ENTRIES.filter((entry) => !entry.requiredModule || client.enabledModules.has(entry.requiredModule))
}

export function resolveModuleId(raw: string | undefined): string | null {
  if (!raw) return null
  const key = raw.toLowerCase().trim()
  return MODULE_ID_ALIASES[key] ?? (ALL_ENTRIES.some((e) => e.id === key) ? key : null)
}

export function findEntry(id: string): ConfigModuleEntry | undefined {
  return ALL_ENTRIES.find((entry) => entry.id === id)
}

export async function openAntiRaidPanel(
  client: Client,
  guild: Guild,
  panelId: AntiRaidPanelId
): Promise<HubComponents> {
  const config = await getAntiRaidConfig(guild.id)
  if (panelId === "mode") return buildModeContainer(client, guild, config)
  if (panelId === "whitelist") return buildWhitelistContainer(client, guild, config)
  if (panelId === "honeypot") return buildHoneypotContainer(client, guild, config)
  if (panelId === "quarantine") return buildQuarantineContainer(client, guild, config)
  if (panelId === "lockdown") return buildLockdownContainer(client, guild, config)
  if (panelId === "logs") return buildLogsContainer(client, guild, config)
  return buildModuleContainer(client, guild, config, panelId as ModuleName)
}

export function isAntiRaidPanelId(value: string): value is AntiRaidPanelId {
  return (ANTI_RAID_PANEL_IDS as readonly string[]).includes(value)
}
