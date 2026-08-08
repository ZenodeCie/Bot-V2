import {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  UserSelectMenuBuilder,
  type Client,
  type Guild,
  type Interaction,
  type MessageComponentInteraction,
} from "discord.js"
import { colors } from "../../config.js"
import formatTime from "../formatTime.js"
import parseTime from "../parseTime.js"
import { buildAntiRaidEmbed, sendLog } from "./logs.js"
import { punishMember } from "./punish.js"
import {
  AntiRaid,
  MODE_LABELS,
  MODES,
  MODULE_DEFAULTS,
  MODULE_LABELS,
  MODULES,
  PREMIUM_MODULES,
  PUNISHMENT_LABELS,
  PUNISHMENTS,
  type AntiRaidConfig,
  type ModuleName,
  type Punishment,
} from "./schema.js"

export const CUSTOM_ID = {
  hub: "ar_hub",
  toggle: "ar_toggle",
  status: "ar_status",
  config: "ar_config",
  mode: "ar_mode",
  lockdown: "ar_lockdown",
  panic: "ar_panic",
  logs: "ar_logs",
  whitelist: "ar_whitelist",
  honeypot: "ar_honeypot",
  test: "ar_test",
  reset: "ar_reset",
  resetConfirm: "ar_reset_confirm",
  resetCancel: "ar_reset_cancel",
  modeSel: "ar_mode_sel",
  configSel: "ar_config_sel",
  configBack: "ar_config_back",
  wlUserAdd: "ar_wl_user_add",
  wlRoleAdd: "ar_wl_role_add",
  wlBotAdd: "ar_wl_bot_add",
  wlChannelAdd: "ar_wl_channel_add",
  wlUserRm: "ar_wl_user_rm",
  wlRoleRm: "ar_wl_role_rm",
  wlBotRm: "ar_wl_bot_rm",
  wlChannelRm: "ar_wl_channel_rm",
  hpToggle: "ar_hp_toggle",
  hpChannelAdd: "ar_hp_channel_add",
  hpChannelRm: "ar_hp_channel_rm",
  hpRoleAdd: "ar_hp_role_add",
  hpRoleRm: "ar_hp_role_rm",
  hpPunish: "ar_hp_punish",
  lockdownOn: "ar_lockdown_on",
  lockdownOff: "ar_lockdown_off",
  lockdownDur: "ar_lockdown_dur",
  panicOn: "ar_panic_on",
  panicOff: "ar_panic_off",
  testRun: "ar_test_run",
  logsPrev: "ar_logs_prev",
  logsNext: "ar_logs_next",
  logsFilter: "ar_logs_filter",
} as const

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2

const section = (content: string, accessory: (btn: ButtonBuilder) => ButtonBuilder): SectionBuilder => {
  const builder = new SectionBuilder().addTextDisplayComponents((text) => text.setContent(content))
  builder.setButtonAccessory(accessory)
  return builder
}

const text = (content: string): TextDisplayBuilder => new TextDisplayBuilder().setContent(content)

const separator = (divider = false): SeparatorBuilder => {
  const builder = new SeparatorBuilder()
  if (divider) builder.setDivider(true)
  return builder
}

const emoji = (name: string) => ({ name })

function moduleState(module: { enabled: boolean }): string {
  return module.enabled ? "✅ Activé" : "❌ Désactivé"
}

function buildBackButton(): ButtonBuilder {
  return new ButtonBuilder().setCustomId(CUSTOM_ID.hub).setLabel("◀ Retour").setStyle(ButtonStyle.Secondary)
}

export function buildHubContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const enabled = config.enabled
  const raidActive = config.raidMode && Date.now() < config.raidEndsAt
  const panicActive = config.panic.active && Date.now() < config.panic.until

  const main = new ContainerBuilder().setAccentColor(enabled ? 0x22c55e : 0xef4444)

  main.addTextDisplayComponents((t) => t.setContent(`# \`🛡️\` 〃 ANTI-RAID\n> *Protection configurable par serveur.*`))
  main.addSeparatorComponents((s) => s.setSpacing(1))

  main.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(`### État global\n> ***Anti-Raid:** ${enabled ? "Activé ✅" : "Désactivé ❌"}*\n> ***Mode:** ${MODE_LABELS[config.mode]}*\n> ***Lockdown:** ${raidActive ? "Actif 🔒" : "Inactif"}*\n> ***Panic:** ${panicActive ? "Actif 💣" : "Inactif"}*`)
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(CUSTOM_ID.toggle)
          .setLabel(" ")
          .setEmoji(emoji(enabled ? "⏹️" : "▶️"))
          .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )

  main.addSeparatorComponents((s) => s.setDivider(true))
  main.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Statut détaillé**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.status).setLabel("Statut").setEmoji(emoji("📊")).setStyle(ButtonStyle.Primary))
  )
  main.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Configuration des modules**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.config).setLabel("Config").setEmoji(emoji("⚙️")).setStyle(ButtonStyle.Primary))
  )
  main.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Mode automatique**\n> Actuel : \`${MODE_LABELS[config.mode]}\``))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.mode).setLabel("Mode").setEmoji(emoji("🧠")).setStyle(ButtonStyle.Primary))
  )
  main.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Verrouillage du serveur**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.lockdown).setLabel("Lockdown").setEmoji(emoji("🚨")).setStyle(ButtonStyle.Danger))
  )
  main.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Mode urgence critique**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.panic).setLabel("Panic").setEmoji(emoji("💣")).setStyle(ButtonStyle.Danger))
  )

  const second = new ContainerBuilder().setAccentColor(enabled ? 0x22c55e : 0xef4444)
  second.addTextDisplayComponents((t) => t.setContent("### \`🧰\` Outils"))
  second.addSeparatorComponents((s) => s.setDivider(true))
  second.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Journalisation**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.logs).setLabel("Logs").setEmoji(emoji("🧾")).setStyle(ButtonStyle.Secondary))
  )
  second.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Liste blanche (users / rôles / bots / salons)**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.whitelist).setLabel("Whitelist").setEmoji(emoji("🧍")).setStyle(ButtonStyle.Secondary))
  )
  second.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Système piège**\n> ${config.honeypot.enabled ? "Activé ✅" : "Désactivé ❌"}`))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.honeypot).setLabel("Honeypot").setEmoji(emoji("🕳️")).setStyle(ButtonStyle.Secondary))
  )
  second.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Simulation du système**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.test).setLabel("Test").setEmoji(emoji("🧪")).setStyle(ButtonStyle.Secondary))
  )
  second.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Réinitialisation complète**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.reset).setLabel("Reset").setEmoji(emoji("🔄")).setStyle(ButtonStyle.Danger))
  )

  return [main, second]
}

export function buildStatusContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const raidActive = config.raidMode && Date.now() < config.raidEndsAt
  const panicActive = config.panic.active && Date.now() < config.panic.until
  const threat = client.antiraid.getThreatLevel(guild.id)
  const quarantineActive = config.quarantine.enabled
  const modulesEnabled = Object.values(config.modules).filter((m) => m.enabled).length

  const container = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`📊\` 〃 Statut anti-raid`))
  container.addSeparatorComponents((s) => s.setSpacing(1))

  const level =
    threat <= 20
      ? "🟢 Faible"
      : threat <= 50
        ? "🟡 Modéré"
        : threat <= 75
          ? "🟠 Élevé"
          : "🔴 Critique"

  container.addTextDisplayComponents((t) =>
    t.setContent(
      `### \`🌡️\` Niveau de menace\n> ***Score global:** \`${threat}/100\` (${level})*\n\n` +
        `### \`⚙️\` État des systèmes\n` +
        `> ***Anti-Raid:** ${config.enabled ? "✅ Activé" : "❌ Désactivé"}*\n` +
        `> ***Mode:** ${MODE_LABELS[config.mode]}*\n` +
        `> ***Anti-Spam:** ${moduleState(config.modules.spam)}*\n` +
        `> ***Anti-Raid joins:** ${moduleState(config.modules.joins)}*\n` +
        `> ***Anti-Nuke:** ${moduleState(config.modules.nuke)}*\n` +
        `> ***Lockdown:** ${raidActive ? "Actif 🔒" : "Inactif"}*\n` +
        `> ***Honeypot:** ${config.honeypot.enabled ? "Activé ✅" : "Désactivé ❌"}*\n` +
        `> ***Quarantaine:** ${quarantineActive ? "Activée ✅" : "Désactivée ❌"}*\n` +
        `> ***Panic:** ${panicActive ? "Actif 💣" : "Inactif"}*\n` +
        `> ***Modules actifs:** ${modulesEnabled}/${MODULES.length}*\n\n` +
        `### \`👥\` Liste blanche\n` +
        `> ***Utilisateurs:** ${config.whitelistedUsers.length}*\n` +
        `> ***Rôles:** ${config.whitelistedRoles.length}*\n` +
        `> ***Bots:** ${config.whitelistedBots.length}*\n` +
        `> ***Salons:** ${config.whitelistedChannels.length}*\n\n` +
        `### \`🛂\` Quarantaine\n` +
        `> ***Utilisateurs en quarantaine:** ${config.quarantine.users.length}*`
    )
  )

  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
      .setButtonAccessory(() => buildBackButton())
  )

  return [container]
}

export function buildConfigContainer(client: Client, guild: Guild, config: AntiRaidConfig, selected?: ModuleName): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`⚙️\` 〃 Configuration`))
  container.addSeparatorComponents((s) => s.setSpacing(1))

  if (!selected) {
    container.addTextDisplayComponents((t) => t.setContent("### Choisissez un module à configurer :"))
    container.addSeparatorComponents((s) => s.setDivider(true))
    const options = MODULES.map((name) => ({
      label: MODULE_LABELS[name],
      value: `mod_${name}`,
      description: `${moduleState(config.modules[name])} — ${PUNISHMENT_LABELS[config.modules[name].punishment]}`,
    }))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_ID.configSel)
          .setPlaceholder("Sélectionner un module...")
          .addOptions(options)
      )
    )
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addSectionComponents((sectionBuilder) =>
      sectionBuilder
        .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
        .setButtonAccessory(() => buildBackButton())
    )
    return [container]
  }

  const module = config.modules[selected]
  const premium = PREMIUM_MODULES.includes(selected)
  const threshold =
    module.interval > 0
      ? `\`${module.limit}\` actions / \`${formatTime(module.interval)}\``
      : "`comportement` (sans seuil)"

  container.addTextDisplayComponents((t) =>
    t.setContent(
      `### \`${MODULE_LABELS[selected]}\`\n` +
        `> ${premium ? "🔒 **Module premium**" : ""}\n` +
        `> ***État:** ${moduleState(module)}*\n` +
        `> ***Seuil:** ${threshold}*\n` +
        `> ***Punition:** ${PUNISHMENT_LABELS[module.punishment]}*\n` +
        `> ***Durée:** ${module.duration > 0 ? formatTime(module.duration) : "Définitif"}*\n` +
        (module.maxAge > 0 ? `> ***Âge max du compte:** ${formatTime(module.maxAge)}*\n` : "") +
        (module.role ? `> ***Rôle:** <@&${module.role}>*\n` : "")
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${moduleState(module)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`ar_mod_toggle_${selected}`)
          .setLabel(" ")
          .setEmoji(emoji(module.enabled ? "⏹️" : "▶️"))
          .setStyle(module.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  const punishOptions = PUNISHMENTS.map((p) => ({
    label: PUNISHMENT_LABELS[p],
    value: p,
    description: p === module.punishment ? "Punition actuelle" : undefined,
    default: p === module.punishment,
  }))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ar_mod_punish_${selected}`)
        .setPlaceholder("Changer la punition...")
        .addOptions(punishOptions)
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  const container2 = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container2.addTextDisplayComponents((t) => t.setContent("### \`🔢\` Réglages du seuil"))
  container2.addSeparatorComponents((s) => s.setDivider(true))

  const durations = [
    { label: "Seuil doux (×2)", value: "limit2" },
    { label: "Seuil actuel", value: "limitCurrent" },
    { label: "Seuil strict (÷2)", value: "limitHalf" },
  ]
  const intervals = [
    { label: "5 secondes", value: "5s" },
    { label: "10 secondes", value: "10s" },
    { label: "30 secondes", value: "30s" },
    { label: "1 minute", value: "1m" },
    { label: "5 minutes", value: "5m" },
  ]
  container2.addTextDisplayComponents((t) => t.setContent("**Ajuster le seuil** (limite / intervalle)"))
  container2.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ar_mod_limit_${selected}`)
        .setPlaceholder("Modifier la limite...")
        .addOptions(durations)
    )
  )
  container2.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ar_mod_interval_${selected}`)
        .setPlaceholder("Modifier l'intervalle...")
        .addOptions(intervals)
    )
  )

  if (module.duration > 0 || module.punishment === "timeout" || module.punishment === "lockdown") {
    container2.addSeparatorComponents((s) => s.setDivider(true))
    container2.addTextDisplayComponents((t) => t.setContent("**Durée de la punition**"))
    const durationsOpts = ["5m", "10m", "30m", "1h", "6h", "24h"].map((value) => ({
      label: value,
      value,
      default: module.duration > 0 && Math.abs(module.duration - parseTime(value)!) < 1000,
    }))
    container2.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ar_mod_duration_${selected}`)
          .setPlaceholder("Modifier la durée...")
          .addOptions(durationsOpts)
      )
    )
  }

  container2.addSeparatorComponents((s) => s.setDivider(true))
  container2.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Choisir un autre module"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.config).setLabel("◀ Modules").setStyle(ButtonStyle.Secondary))
  )

  return [container, container2]
}

export function buildModeContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`🧠\` 〃 Mode automatique`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Le mode ajuste automatiquement les seuils, la sensibilité et l'agressivité des actions.*\n> *Les réglages personnalisés (\`custom\`) ne sont pas écrasés.*\n\n> ***Mode actuel:** ${MODE_LABELS[config.mode]}*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  const options = MODES.map((mode) => ({
    label: MODE_LABELS[mode],
    value: mode,
    description: mode === config.mode ? "Mode actuel" : undefined,
    default: mode === config.mode,
  }))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder().setCustomId(CUSTOM_ID.modeSel).setPlaceholder("Choisir un mode...").addOptions(options)
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
      .setButtonAccessory(() => buildBackButton())
  )
  return [container]
}

export function buildLockdownContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const raidActive = config.raidMode && Date.now() < config.raidEndsAt
  const container = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`🚨\` 〃 Lockdown`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `### État\n> ***Lockdown:** ${raidActive ? "Actif 🔒" : "Inactif"}*\n` +
        (raidActive ? `> ***Jusqu'à:** <t:${Math.floor(config.raidEndsAt / 1000)}:T>*\n` : "") +
        `> ***Slowmode global:** ${config.lockdown.slowmode > 0 ? formatTime(config.lockdown.slowmode) : "Désactivé"}*\n` +
        `> ***Blocage des messages:** ${config.lockdown.blockMessages ? "Activé ✅" : "Désactivé ❌"}*\n` +
        `> ***Blocage des arrivées:** ${config.lockdown.blockJoins ? "Activé ✅" : "Désactivé ❌"}*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Activer le verrouillage**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.lockdownOn).setLabel("ON").setEmoji(emoji("🔒")).setStyle(ButtonStyle.Success))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Désactiver le verrouillage**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.lockdownOff).setLabel("OFF").setEmoji(emoji("🔓")).setStyle(ButtonStyle.Danger))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent("**Durée du verrouillage**"))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_ID.lockdownDur)
        .setPlaceholder("Choisir la durée...")
        .addOptions(["10m", "30m", "1h", "6h", "12h", "24h"].map((value) => ({ label: value, value })))
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
      .setButtonAccessory(() => buildBackButton())
  )
  return [container]
}

export function buildPanicContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const panicActive = config.panic.active && Date.now() < config.panic.until
  const container = new ContainerBuilder().setAccentColor(panicActive ? 0xef4444 : 0x22c55e)
  container.addTextDisplayComponents((t) => t.setContent(`# \`💣\` 〃 Mode Panic`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Le mode panic est le **niveau d'urgence critique** : il verrouille le serveur, bloque les arrivées et gèle les salons critiques.*\n\n` +
        `> ***Panic:** ${panicActive ? "Actif 💣" : "Inactif"}*` +
        (panicActive ? `\n> ***Jusqu'à:** <t:${Math.floor(config.panic.until / 1000)}:T>*` : "")
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Déclencher le mode urgence**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.panicOn).setLabel("PANIC ON").setEmoji(emoji("💣")).setStyle(ButtonStyle.Danger))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Restaurer l'état précédent**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.panicOff).setLabel("RESTORE").setEmoji(emoji("♻️")).setStyle(ButtonStyle.Secondary))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
      .setButtonAccessory(() => buildBackButton())
  )
  return [container]
}

export function buildWhitelistContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`🧍\` 〃 Liste blanche`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `### \`👥\` Utilisateurs (${config.whitelistedUsers.length})\n` +
        (config.whitelistedUsers.length > 0
          ? config.whitelistedUsers.map((id) => `> <@${id}>`).join("\n") + "\n"
          : "> *Aucun*\n") +
        `### \`🎭\` Rôles (${config.whitelistedRoles.length})\n` +
        (config.whitelistedRoles.length > 0
          ? config.whitelistedRoles.map((id) => `> <@&${id}>`).join("\n") + "\n"
          : "> *Aucun*\n") +
        `### \`🤖\` Bots (${config.whitelistedBots.length})\n` +
        (config.whitelistedBots.length > 0
          ? config.whitelistedBots.map((id) => `> <@${id}>`).join("\n") + "\n"
          : "> *Aucun*\n") +
        `### \`📁\` Salons (${config.whitelistedChannels.length})\n` +
        (config.whitelistedChannels.length > 0
          ? config.whitelistedChannels.map((id) => `> <#${id}>`).join("\n")
          : "> *Aucun*")
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addTextDisplayComponents((t) => t.setContent("**Ajouter**"))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new UserSelectMenuBuilder().setCustomId(CUSTOM_ID.wlUserAdd).setPlaceholder("Ajouter des utilisateurs...").setMaxValues(5)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId(CUSTOM_ID.wlRoleAdd).setPlaceholder("Ajouter des rôles...").setMaxValues(5)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new UserSelectMenuBuilder().setCustomId(CUSTOM_ID.wlBotAdd).setPlaceholder("Ajouter des bots...").setMaxValues(5)
    )
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder().setCustomId(CUSTOM_ID.wlChannelAdd).setPlaceholder("Ajouter des salons...").setMaxValues(5)
    )
  )

  const container2 = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container2.addTextDisplayComponents((t) => t.setContent("**Retirer**"))

  const rmUserOptions = config.whitelistedUsers.slice(0, 25).map((id) => ({ label: `Utilisateur ${id}`, value: id }))
  if (rmUserOptions.length > 0) {
    container2.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_ID.wlUserRm)
          .setPlaceholder("Retirer des utilisateurs...")
          .addOptions(rmUserOptions)
          .setMinValues(1)
          .setMaxValues(Math.min(rmUserOptions.length, 25))
      )
    )
  }
  const rmRoleOptions = config.whitelistedRoles.slice(0, 25).map((id) => ({ label: `Rôle ${id}`, value: id }))
  if (rmRoleOptions.length > 0) {
    container2.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_ID.wlRoleRm)
          .setPlaceholder("Retirer des rôles...")
          .addOptions(rmRoleOptions)
          .setMinValues(1)
          .setMaxValues(Math.min(rmRoleOptions.length, 25))
      )
    )
  }
  const rmBotOptions = config.whitelistedBots.slice(0, 25).map((id) => ({ label: `Bot ${id}`, value: id }))
  if (rmBotOptions.length > 0) {
    container2.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_ID.wlBotRm)
          .setPlaceholder("Retirer des bots...")
          .addOptions(rmBotOptions)
          .setMinValues(1)
          .setMaxValues(Math.min(rmBotOptions.length, 25))
      )
    )
  }
  const rmChannelOptions = config.whitelistedChannels.slice(0, 25).map((id) => ({ label: `Salon ${id}`, value: id }))
  if (rmChannelOptions.length > 0) {
    container2.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_ID.wlChannelRm)
          .setPlaceholder("Retirer des salons...")
          .addOptions(rmChannelOptions)
          .setMinValues(1)
          .setMaxValues(Math.min(rmChannelOptions.length, 25))
      )
    )
  }

  container2.addSeparatorComponents((s) => s.setDivider(true))
  container2.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
      .setButtonAccessory(() => buildBackButton())
  )

  return [container, container2]
}

export function buildHoneypotContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(config.honeypot.enabled ? 0x22c55e : 0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`🕳️\` 〃 Honeypot`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Système piège : toute interaction avec un salon ou un rôle piège déclenche une punition automatique.*\n\n` +
        `> ***État:** ${config.honeypot.enabled ? "Activé ✅" : "Désactivé ❌"}*\n` +
        `> ***Punition:** ${PUNISHMENT_LABELS[config.honeypot.punishment]}*\n` +
        `> ***Salons pièges:** ${config.honeypot.channels.length > 0 ? config.honeypot.channels.map((id) => `<#${id}>`).join(", ") : "*Aucun*"}*\n` +
        `> ***Rôles pièges:** ${config.honeypot.roles.length > 0 ? config.honeypot.roles.map((id) => `<@&${id}>`).join(", ") : "*Aucun*"}*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${config.honeypot.enabled ? "Activé ✅" : "Désactivé ❌"}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(CUSTOM_ID.hpToggle)
          .setLabel(" ")
          .setEmoji(emoji(config.honeypot.enabled ? "⏹️" : "▶️"))
          .setStyle(config.honeypot.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addTextDisplayComponents((t) => t.setContent("**Ajouter un salon piège**"))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder().setCustomId(CUSTOM_ID.hpChannelAdd).setPlaceholder("Choisir des salons...").setMaxValues(5)
    )
  )
  container.addTextDisplayComponents((t) => t.setContent("**Ajouter un rôle piège**"))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId(CUSTOM_ID.hpRoleAdd).setPlaceholder("Choisir des rôles...").setMaxValues(5)
    )
  )

  const container2 = new ContainerBuilder().setAccentColor(config.honeypot.enabled ? 0x22c55e : 0xef4444)
  container2.addTextDisplayComponents((t) => t.setContent("**Punition appliquée aux intrus**"))
  container2.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_ID.hpPunish)
        .setPlaceholder("Choisir la punition...")
        .addOptions(
          PUNISHMENTS.filter((p) => p !== "lockdown" && p !== "none").map((p) => ({
            label: PUNISHMENT_LABELS[p],
            value: p,
            default: p === config.honeypot.punishment,
          }))
        )
    )
  )
  container2.addSeparatorComponents((s) => s.setDivider(true))
  if (config.honeypot.channels.length > 0) {
    container2.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_ID.hpChannelRm)
          .setPlaceholder("Retirer des salons pièges...")
          .addOptions(config.honeypot.channels.slice(0, 25).map((id) => ({ label: `Salon ${id}`, value: id })))
          .setMinValues(1)
          .setMaxValues(Math.min(config.honeypot.channels.length, 25))
      )
    )
  }
  if (config.honeypot.roles.length > 0) {
    container2.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_ID.hpRoleRm)
          .setPlaceholder("Retirer des rôles pièges...")
          .addOptions(config.honeypot.roles.slice(0, 25).map((id) => ({ label: `Rôle ${id}`, value: id })))
          .setMinValues(1)
          .setMaxValues(Math.min(config.honeypot.roles.length, 25))
      )
    )
  }
  container2.addSeparatorComponents((s) => s.setDivider(true))
  container2.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
      .setButtonAccessory(() => buildBackButton())
  )

  return [container, container2]
}

export function buildLogsContainer(client: Client, guild: Guild, config: AntiRaidConfig, page = 0, filter?: string): ContainerBuilder[] {
  const events = client.antiraid.getEventLog(guild.id)
  const filtered = filter ? events.filter((e) => e.type === filter) : events
  const perPage = 8
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)
  const slice = filtered.slice(safePage * perPage, (safePage + 1) * perPage)

  const container = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`🧾\` 〃 Journal des événements`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      slice.length > 0
        ? slice
            .map(
              (e) =>
                `> \`<t:${Math.floor(e.ts / 1000)}:R>\` \`${e.type}\` — ${e.detail ?? "..."}`
            )
            .join("\n")
        : "> *Aucun événement enregistré.*"
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  const filterOptions = ["spam", "mentions", "links", "emojis", "joins", "bots", "nuke", "selfbots", "honeypot", "lockdown", "panic", "verify", "other"].map(
    (type) => ({
      label: type,
      value: type,
      default: filter === type,
    })
  )
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder().setCustomId(CUSTOM_ID.logsFilter).setPlaceholder("Filtrer par type...").addOptions(filterOptions)
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`Page \`${safePage + 1}/${totalPages}\` (${filtered.length} événements)`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(CUSTOM_ID.logsPrev)
          .setLabel("◀")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage <= 0)
      )
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Page suivante"))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(CUSTOM_ID.logsNext)
          .setLabel("▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
      .setButtonAccessory(() => buildBackButton())
  )
  return [container]
}

export function buildTestContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(config.enabled ? 0x22c55e : 0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`🧪\` 〃 Test & Simulation`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Simule les attaques sans appliquer la moindre action réelle. Le bot affiche ce qu'il aurait fait :* \`WOULD BAN\`, \`WOULD TIMEOUT\`, \`WOULD DELETE\`.\n\n` +
        `> ***Envoie un test dans le journal** : bouton ci-dessous.*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Envoyer un message de test dans le journal**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.testRun).setLabel("Lancer").setEmoji(emoji("🚀")).setStyle(ButtonStyle.Success))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("Retour au panneau principal"))
      .setButtonAccessory(() => buildBackButton())
  )
  return [container]
}

export function buildResetContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(0xef4444)
  container.addTextDisplayComponents((t) => t.setContent(`# \`🔄\` 〃 Réinitialisation`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *⚠️ **Action irréversible.*** *Toute la configuration anti-raid de ce serveur sera réinitialisée aux valeurs par défaut (modules, mode, lockdown, honeypot, quarantaine, whitelist, journal).*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Confirmer la réinitialisation**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.resetConfirm).setLabel("OUI, RÉINITIALISER").setStyle(ButtonStyle.Danger))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Annuler**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.resetCancel).setLabel("NON").setStyle(ButtonStyle.Secondary))
  )
  return [container]
}

export async function showDashboard(client: Client, message: { guild: Guild; channel: { id: string }; reply: (options: object) => Promise<unknown> }, config: AntiRaidConfig) {
  return message.reply({ components: buildHubContainer(client, message.guild, config), flags: COMPONENTS_V2_FLAGS })
}

async function updatePanel(interaction: MessageComponentInteraction, containers: ContainerBuilder[]) {
  return interaction.update({ components: containers, flags: COMPONENTS_V2_FLAGS })
}

export async function handleDashboardInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ar_")) return false

  const guild = interaction.guild
  if (!guild) return false
  const config = await client.antiraid.getConfig(guild.id)

  const member = interaction.member
  const memberPermissions =
    member && typeof member.permissions === "object" && member.permissions !== null
      ? member.permissions
      : null
  if (!member || !memberPermissions || !memberPermissions.has("Administrator")) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: "> *Cette action nécessite la permission **Administrator**.*",
        flags: MessageFlags.Ephemeral,
      })
    }
    return true
  }

  const get = async () => client.antiraid.getConfig(guild.id)

  switch (customId) {
    case CUSTOM_ID.hub:
      await updatePanel(interaction, buildHubContainer(client, guild, config))
      return true

    case CUSTOM_ID.toggle: {
      const current = await get()
      const enabled = !current.enabled
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $set: { enabled } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      await updatePanel(interaction, buildHubContainer(client, guild, { ...current, enabled }))
      await sendLog(
        client,
        guild.id,
        buildAntiRaidEmbed(
          "✅",
          enabled ? "Anti-Raid activé" : "Anti-Raid désactivé",
          `> ***Par:** <@${interaction.user.id}>*\n> *État : ${enabled ? "Activé" : "Désactivé"}.*`,
          enabled ? colors.red : colors.yel
        )
      )
      return true
    }

    case CUSTOM_ID.status:
      await updatePanel(interaction, buildStatusContainer(client, guild, config))
      return true

    case CUSTOM_ID.config:
      await updatePanel(interaction, buildConfigContainer(client, guild, config))
      return true

    case CUSTOM_ID.configBack:
    case "ar_config_back":
      await updatePanel(interaction, buildConfigContainer(client, guild, config))
      return true

    case CUSTOM_ID.mode:
      await updatePanel(interaction, buildModeContainer(client, guild, config))
      return true

    case CUSTOM_ID.lockdown:
      await updatePanel(interaction, buildLockdownContainer(client, guild, config))
      return true

    case CUSTOM_ID.panic:
      await updatePanel(interaction, buildPanicContainer(client, guild, config))
      return true

    case CUSTOM_ID.whitelist:
      await updatePanel(interaction, buildWhitelistContainer(client, guild, config))
      return true

    case CUSTOM_ID.honeypot:
      await updatePanel(interaction, buildHoneypotContainer(client, guild, config))
      return true

    case CUSTOM_ID.logs:
      await updatePanel(interaction, buildLogsContainer(client, guild, config))
      return true

    case CUSTOM_ID.test:
      await updatePanel(interaction, buildTestContainer(client, guild, config))
      return true

    case CUSTOM_ID.reset:
      await updatePanel(interaction, buildResetContainer(client, guild, config))
      return true

    case CUSTOM_ID.resetConfirm: {
      const resetModules = {} as AntiRaidConfig["modules"]
      for (const name of MODULES) resetModules[name] = { ...MODULE_DEFAULTS[name] }
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        {
          $set: {
            enabled: false,
            mode: "balanced",
            raidMode: false,
            raidEndsAt: 0,
            logChannel: null,
            whitelistedUsers: [],
            whitelistedRoles: [],
            whitelistedBots: [],
            whitelistedChannels: [],
            honeypot: { enabled: false, channels: [], roles: [], punishment: "ban", duration: 0 },
            quarantine: { enabled: false, role: null, users: [] },
            panic: { active: false, until: 0 },
            lockdown: { slowmode: 0, blockJoins: false, blockMessages: true },
            modules: resetModules,
          },
        },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      client.antiraid.clearEventLog(guild.id)
      const fresh = await client.antiraid.getConfig(guild.id)
      await updatePanel(interaction, buildHubContainer(client, guild, fresh))
      await sendLog(client, guild.id, buildAntiRaidEmbed("🔄", "Configuration réinitialisée", `> ***Par:** <@${interaction.user.id}>*`, colors.yel))
      return true
    }

    case CUSTOM_ID.resetCancel: {
      const fresh = await get()
      await updatePanel(interaction, buildHubContainer(client, guild, fresh))
      return true
    }

    case CUSTOM_ID.testRun: {
      await sendLog(client, guild.id, buildAntiRaidEmbed("🧪", "Test anti-raid", `> *Test demandé par <@${interaction.user.id}>. Le système fonctionne.*`, colors.yel))
      await updatePanel(interaction, buildTestContainer(client, guild, config))
      return true
    }

    case CUSTOM_ID.lockdownOn: {
      await client.antiraid.activateRaidMode(client, config, config.raidDuration)
      const fresh = await get()
      await updatePanel(interaction, buildLockdownContainer(client, guild, fresh))
      return true
    }

    case CUSTOM_ID.lockdownOff: {
      await client.antiraid.deactivateRaidMode(client, config)
      const fresh = await get()
      await updatePanel(interaction, buildLockdownContainer(client, guild, fresh))
      return true
    }

    case CUSTOM_ID.panicOn: {
      await client.antiraid.activatePanic(client, config)
      const fresh = await get()
      await updatePanel(interaction, buildPanicContainer(client, guild, fresh))
      return true
    }

    case CUSTOM_ID.panicOff: {
      await client.antiraid.deactivatePanic(client, config)
      const fresh = await get()
      await updatePanel(interaction, buildPanicContainer(client, guild, fresh))
      return true
    }

    default:
      break
  }

  if (interaction.isStringSelectMenu()) {
    const value = interaction.values[0]

    if (customId === CUSTOM_ID.modeSel) {
      if (MODES.includes(value as (typeof MODES)[number])) {
        await client.antiraid.applyMode(client, guild.id, value as (typeof MODES)[number])
        const fresh = await get()
        await updatePanel(interaction, buildModeContainer(client, guild, fresh))
      }
      return true
    }

    if (customId === CUSTOM_ID.configSel) {
      const name = value.replace(/^mod_/, "") as ModuleName
      if (MODULES.includes(name)) {
        await updatePanel(interaction, buildConfigContainer(client, guild, config, name))
      }
      return true
    }

    if (customId === CUSTOM_ID.logsFilter) {
      await updatePanel(interaction, buildLogsContainer(client, guild, config, 0, value))
      return true
    }

    if (customId === CUSTOM_ID.lockdownDur) {
      const duration = parseTime(value)
      if (duration !== null) {
        await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $set: { raidDuration: duration } }, { upsert: true })
        client.antiraid.invalidateConfig(guild.id)
        const fresh = await get()
        await updatePanel(interaction, buildLockdownContainer(client, guild, fresh))
      }
      return true
    }

    if (customId === CUSTOM_ID.hpPunish) {
      if (PUNISHMENTS.includes(value as Punishment)) {
        await AntiRaid.findOneAndUpdate(
          { guildId: guild.id },
          { $set: { "honeypot.punishment": value } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(guild.id)
        const fresh = await get()
        await updatePanel(interaction, buildHoneypotContainer(client, guild, fresh))
      }
      return true
    }

    const wlRm = customId.match(/^ar_wl_(user|role|bot|channel)_rm$/)
    if (wlRm) {
      const type = wlRm[1]
      const field =
        type === "user" ? "whitelistedUsers" : type === "role" ? "whitelistedRoles" : type === "bot" ? "whitelistedBots" : "whitelistedChannels"
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $pullAll: { [field]: interaction.values } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      const fresh = await get()
      await updatePanel(interaction, buildWhitelistContainer(client, guild, fresh))
      return true
    }

    const hpRm = customId.match(/^ar_hp_(channel|role)_rm$/)
    if (hpRm) {
      const field = hpRm[1] === "channel" ? "honeypot.channels" : "honeypot.roles"
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $pullAll: { [field]: interaction.values } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      const fresh = await get()
      await updatePanel(interaction, buildHoneypotContainer(client, guild, fresh))
      return true
    }

    const modToggle = customId.match(/^ar_mod_toggle_(\w+)$/)
    if (modToggle) {
      const name = modToggle[1] as ModuleName
      if (MODULES.includes(name)) {
        const current = await get()
        const enabled = !current.modules[name].enabled
        await AntiRaid.findOneAndUpdate(
          { guildId: guild.id },
          { $set: { [`modules.${name}.enabled`]: enabled, mode: "custom" } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(guild.id)
        const fresh = await get()
        await updatePanel(interaction, buildConfigContainer(client, guild, fresh, name))
      }
      return true
    }

    const modPunish = customId.match(/^ar_mod_punish_(\w+)$/)
    if (modPunish) {
      const name = modPunish[1] as ModuleName
      if (MODULES.includes(name) && PUNISHMENTS.includes(value as Punishment)) {
        let duration = (await get()).modules[name].duration
        if ((value === "timeout" || value === "lockdown") && duration <= 0) duration = 600000
        if (value !== "timeout" && value !== "lockdown") duration = 0
        await AntiRaid.findOneAndUpdate(
          { guildId: guild.id },
          {
            $set: {
              [`modules.${name}.punishment`]: value,
              [`modules.${name}.duration`]: duration,
              mode: "custom",
            },
          },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(guild.id)
        const fresh = await get()
        await updatePanel(interaction, buildConfigContainer(client, guild, fresh, name))
      }
      return true
    }

    const modLimit = customId.match(/^ar_mod_limit_(\w+)$/)
    if (modLimit) {
      const name = modLimit[1] as ModuleName
      if (MODULES.includes(name)) {
        const current = await get()
        const base = current.modules[name].limit
        const next =
          value === "limit2" ? Math.max(1, Math.round(base * 2)) : value === "limitHalf" ? Math.max(1, Math.round(base / 2)) : base
        await AntiRaid.findOneAndUpdate(
          { guildId: guild.id },
          { $set: { [`modules.${name}.limit`]: next, mode: "custom" } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(guild.id)
        const fresh = await get()
        await updatePanel(interaction, buildConfigContainer(client, guild, fresh, name))
      }
      return true
    }

    const modInterval = customId.match(/^ar_mod_interval_(\w+)$/)
    if (modInterval) {
      const name = modInterval[1] as ModuleName
      if (MODULES.includes(name)) {
        const parsed = parseTime(value)
        if (parsed !== null) {
          await AntiRaid.findOneAndUpdate(
            { guildId: guild.id },
            { $set: { [`modules.${name}.interval`]: parsed, mode: "custom" } },
            { upsert: true }
          )
          client.antiraid.invalidateConfig(guild.id)
          const fresh = await get()
          await updatePanel(interaction, buildConfigContainer(client, guild, fresh, name))
        }
      }
      return true
    }

    const modDuration = customId.match(/^ar_mod_duration_(\w+)$/)
    if (modDuration) {
      const name = modDuration[1] as ModuleName
      if (MODULES.includes(name)) {
        const parsed = parseTime(value)
        if (parsed !== null) {
          await AntiRaid.findOneAndUpdate(
            { guildId: guild.id },
            { $set: { [`modules.${name}.duration`]: parsed, mode: "custom" } },
            { upsert: true }
          )
          client.antiraid.invalidateConfig(guild.id)
          const fresh = await get()
          await updatePanel(interaction, buildConfigContainer(client, guild, fresh, name))
        }
      }
      return true
    }

    return true
  }

  if (interaction.isUserSelectMenu()) {
    if (customId === CUSTOM_ID.wlUserAdd || customId === CUSTOM_ID.wlBotAdd) {
      const field = customId === CUSTOM_ID.wlUserAdd ? "whitelistedUsers" : "whitelistedBots"
      const ids = interaction.values.filter((id) => id !== client.user?.id)
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { [field]: { $each: ids } } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      const fresh = await get()
      await updatePanel(interaction, buildWhitelistContainer(client, guild, fresh))
      return true
    }
  }

  if (interaction.isRoleSelectMenu()) {
    if (customId === CUSTOM_ID.wlRoleAdd) {
      const ids = interaction.values
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { whitelistedRoles: { $each: ids } } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      const fresh = await get()
      await updatePanel(interaction, buildWhitelistContainer(client, guild, fresh))
      return true
    }
    if (customId === CUSTOM_ID.hpRoleAdd) {
      const ids = interaction.values
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { "honeypot.roles": { $each: ids } } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      const fresh = await get()
      await updatePanel(interaction, buildHoneypotContainer(client, guild, fresh))
      return true
    }
  }

  if (interaction.isChannelSelectMenu()) {
    if (customId === CUSTOM_ID.wlChannelAdd) {
      const ids = interaction.values
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { whitelistedChannels: { $each: ids } } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      const fresh = await get()
      await updatePanel(interaction, buildWhitelistContainer(client, guild, fresh))
      return true
    }
    if (customId === CUSTOM_ID.hpChannelAdd) {
      const ids = interaction.values
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { "honeypot.channels": { $each: ids } } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      const fresh = await get()
      await updatePanel(interaction, buildHoneypotContainer(client, guild, fresh))
      return true
    }
  }

  return true
}
