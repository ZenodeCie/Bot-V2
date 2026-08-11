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
import {
  AntiRaid,
  MODE_LABELS,
  MODES,
  MODULE_LABELS,
  MODULES,
  PUNISHMENT_LABELS,
  PUNISHMENTS,
  type AntiRaidConfig,
  type ModuleName,
  type Punishment,
} from "./schema.js"

export const CUSTOM_ID = {
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
  modeSel: "ar_mode_sel",
  logsFilter: "ar_logs_filter",
  logsChannel: "ar_logs_channel",
  qAdd: "ar_q_add",
  qRm: "ar_q_rm",
  qClear: "ar_q_clear",
  lockdownOn: "ar_lockdown_on",
  lockdownOff: "ar_lockdown_off",
  lockdownDur: "ar_lockdown_dur",
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

const EMOJI_IDS = {
  add: "1469692082107977782",
  addUser: "1469692085992034387",
  bot: "1469692094342762526",
  cancel: "1469692099736895592",
  channel: "1469692104589705376",
  check: "1469692151251341425",
  cog: "1469692155680526427",
  cogUser: "1469692167122325577",
  color: "1469692171706962071",
  disable: "1469692191298556099",
  duration: "1469692196331458704",
  electricStar: "1469692210961322025",
  emoji: "1469692247107965071",
  enable: "1469692252988116992",
  eye: "1469692577384235161",
  file: "1469692584959017070",
  leave: "1469692941068009686",
  light: "1469692975096402071",
  loop: "1469692980586872957",
  noPaper: "1469692984961536041",
  notes: "1469692988870623369",
  paper: "1469692994428080191",
  party: "1469693039739146435",
  pause: "1469693044256145610",
  pen: "1469693057497563160",
  pending: "1469693062543311044",
  people: "1469693090280505458",
  permDisable: "1469693096278229002",
  pin: "1469696535850651933",
  plane: "1469696552934183005",
  heart: "1469692928229245043",
  gMute: "1469685636217962549",
} as const

const emoji = (key: keyof typeof EMOJI_IDS): { id: string } => ({ id: EMOJI_IDS[key] })

const EMOJI_TAGS = {
  add: "<:Add:1469692082107977782>",
  addUser: "<:AddUser:1469692085992034387>",
  bot: "<:Bot:1469692094342762526>",
  cancel: "<:Cancel:1469692099736895592>",
  channel: "<:Channel:1469692104589705376>",
  check: "<:Check:1469692151251341425>",
  cog: "<:Cog:1469692155680526427>",
  cogUser: "<:CogUser:1469692167122325577>",
  color: "<:Color:1469692171706962071>",
  disable: "<:Disable:1469692191298556099>",
  duration: "<:Duration:1469692196331458704>",
  electricStar: "<:ElectricStar:1469692210961322025>",
  emoji: "<:Emoji:1469692247107965071>",
  enable: "<:Enable:1469692252988116992>",
  eye: "<:Eye:1469692577384235161>",
  file: "<:File:1469692584959017070>",
  heart: "<:Heart:1469692928229245043>",
  leave: "<:Leave:1469692941068009686>",
  light: "<:Light:1469692975096402071>",
  loop: "<:Loop:1469692980586872957>",
  noPaper: "<:NoPaper:1469692984961536041>",
  notes: "<:Notes:1469692988870623369>",
  paper: "<:Paper:1469692994428080191>",
  party: "<:Party:1469693039739146435>",
  pause: "<:Pause:1469693044256145610>",
  pen: "<:Pen:1469693057497563160>",
  pending: "<:Pending:1469693062543311044>",
  people: "<:People:1469693090280505458>",
  permDisable: "<:PermDisable:1469693096278229002>",
  pin: "<:Pin:1469696535850651933>",
  plane: "<:Plane:1469696552934183005>",
  gMute: "<:g_mute:1469685636217962549>",
} as const

const CONTAINER_ACCENT = 0x36373e

const MODULE_EMOJIS: Record<ModuleName, string> = {
  spam: EMOJI_TAGS.notes,
  mentions: EMOJI_TAGS.cogUser,
  links: EMOJI_TAGS.plane,
  emojis: EMOJI_TAGS.emoji,
  joins: EMOJI_TAGS.addUser,
  bots: EMOJI_TAGS.bot,
  nuke: EMOJI_TAGS.permDisable,
  selfbots: EMOJI_TAGS.loop,
  badword: EMOJI_TAGS.noPaper,
}

function moduleState(module: { enabled: boolean }): string {
  return module.enabled ? `${EMOJI_TAGS.enable} Activé` : `${EMOJI_TAGS.disable} Désactivé`
}

async function updatePanel(interaction: MessageComponentInteraction, containers: ContainerBuilder[]) {
  return interaction.update({ components: containers, flags: COMPONENTS_V2_FLAGS })
}

function logsNavId(dir: "prev" | "next", page: number, filter?: string): string {
  return `ar_logs_${dir}_${page}_${filter ?? "all"}`
}

async function requireAdmin(interaction: Interaction): Promise<boolean> {
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
    return false
  }
  return true
}

export function buildModuleContainer(client: Client, guild: Guild, config: AntiRaidConfig, selected: ModuleName): ContainerBuilder[] {
  const module = config.modules[selected]
  const threshold =
    module.interval > 0
      ? `\`${module.limit}\` actions / \`${formatTime(module.interval)}\``
      : "`comportement` (sans seuil)"

  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${MODULE_EMOJIS[selected]} 〃 ${MODULE_LABELS[selected]}`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> ***État:** ${moduleState(module)}*\n` +
        `> ${EMOJI_TAGS.cog} ***Seuil:** ${threshold}*\n` +
        `> ${EMOJI_TAGS.gMute} ***Punition:** ${PUNISHMENT_LABELS[module.punishment]}*\n` +
        `> ${EMOJI_TAGS.duration} ***Durée:** ${module.duration > 0 ? formatTime(module.duration) : "Définitif"}*\n` +
        (module.maxAge > 0 ? `> ${EMOJI_TAGS.pending} ***Âge max du compte:** ${formatTime(module.maxAge)}*\n` : "") +
        (module.role ? `> ${EMOJI_TAGS.cogUser} ***Rôle:** <@&${module.role}>*\n` : "")
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${moduleState(module)}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(`ar_mod_toggle_${selected}`)
          .setEmoji(module.enabled ? emoji("disable") : emoji("enable"))
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

  container.addTextDisplayComponents((t) => t.setContent(`### ${EMOJI_TAGS.cog} Réglages du seuil`))
  container.addSeparatorComponents((s) => s.setDivider(true))

  if (module.interval > 0) {
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
    container.addTextDisplayComponents((t) => t.setContent("**Ajuster le seuil** (limite / intervalle)"))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ar_mod_limit_${selected}`)
          .setPlaceholder("Modifier la limite...")
          .addOptions(durations)
      )
    )
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ar_mod_interval_${selected}`)
          .setPlaceholder("Modifier l'intervalle...")
          .addOptions(intervals)
      )
    )
  }

  if (module.duration > 0 || module.punishment === "timeout" || module.punishment === "lockdown") {
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.duration} **Durée de la punition**`))
    const durationsOpts = ["5m", "10m", "30m", "1h", "6h", "24h"].map((value) => ({
      label: value,
      value,
      default: module.duration > 0 && Math.abs(module.duration - parseTime(value)!) < 1000,
    }))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ar_mod_duration_${selected}`)
          .setPlaceholder("Modifier la durée...")
          .addOptions(durationsOpts)
      )
    )
  }

  addModuleSpecific(container, config, selected)

  return [container]
}

function addModuleSpecific(container: ContainerBuilder, config: AntiRaidConfig, selected: ModuleName) {
  const module = config.modules[selected]

  if (selected === "mentions") {
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addTextDisplayComponents((t) => t.setContent(`### ${EMOJI_TAGS.cogUser} Options de mention`))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ar_mentions_maxuser")
          .setPlaceholder("Max mentions utilisateurs / message...")
          .addOptions([2, 3, 5, 10, 15, 20].map((n) => ({ label: `${n} mentions`, value: String(n), default: module.maxUserMentions === n })))
      )
    )
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ar_mentions_maxrole")
          .setPlaceholder("Max mentions rôles / message...")
          .addOptions([1, 2, 3, 5, 8, 10].map((n) => ({ label: `${n} mentions`, value: String(n), default: module.maxRoleMentions === n })))
      )
    )
    container.addSectionComponents((sectionBuilder) =>
      sectionBuilder
        .addTextDisplayComponents((t) => t.setContent(`**Autoriser @everyone / @here**\n> ${module.allowEveryone ? `Autorisé ${EMOJI_TAGS.enable}` : `Bloqué ${EMOJI_TAGS.disable}`}`))
        .setButtonAccessory((btn) =>
          btn
            .setCustomId("ar_mentions_everyone")
            .setEmoji(module.allowEveryone ? emoji("enable") : emoji("disable"))
            .setStyle(module.allowEveryone ? ButtonStyle.Success : ButtonStyle.Danger)
        )
    )
  }

  if (selected === "links") {
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addTextDisplayComponents((t) => t.setContent(`### ${EMOJI_TAGS.plane} Options des liens`))
    container.addSectionComponents((sectionBuilder) =>
      sectionBuilder
        .addTextDisplayComponents((t) => t.setContent(`**Bloquer les invitations Discord**\n> ${module.blockDiscordInvites ? `Activé ${EMOJI_TAGS.enable}` : `Désactivé ${EMOJI_TAGS.disable}`}`))
        .setButtonAccessory((btn) =>
          btn
            .setCustomId("ar_links_invites")
            .setEmoji(module.blockDiscordInvites ? emoji("enable") : emoji("disable"))
            .setStyle(module.blockDiscordInvites ? ButtonStyle.Success : ButtonStyle.Danger)
        )
    )
    if (module.allowedDomains.length > 0) {
      container.addTextDisplayComponents((t) => t.setContent(`**Domaines autorisés (${module.allowedDomains.length})**`))
      container.addActionRowComponents((row) =>
        row.setComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ar_links_allowrm")
            .setPlaceholder("Retirer des domaines autorisés...")
            .addOptions(module.allowedDomains.slice(0, 25).map((d) => ({ label: d, value: d })))
            .setMinValues(1)
            .setMaxValues(Math.min(module.allowedDomains.length, 25))
        )
      )
    }
    if (module.blockedDomains.length > 0) {
      container.addTextDisplayComponents((t) => t.setContent(`**Domaines bloqués (${module.blockedDomains.length})**`))
      container.addActionRowComponents((row) =>
        row.setComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ar_links_blockrm")
            .setPlaceholder("Retirer des domaines bloqués...")
            .addOptions(module.blockedDomains.slice(0, 25).map((d) => ({ label: d, value: d })))
            .setMinValues(1)
            .setMaxValues(Math.min(module.blockedDomains.length, 25))
        )
      )
    }
    container.addTextDisplayComponents((t) =>
      t.setContent("> *Ajoutez des domaines avec : \`antilinks allow <domaine>\` ou \`antilinks block <domaine>\`.*")
    )
  }

  if (selected === "nuke") {
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addTextDisplayComponents((t) => t.setContent(`### ${EMOJI_TAGS.permDisable} Seuils destructifs`))
    const thresholdOptions = (current: number) =>
      [1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ label: `${n} action${n > 1 ? "s" : ""}`, value: String(n), default: current === n }))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ar_nuke_chan")
          .setPlaceholder("Suppressions de salons...")
          .addOptions(thresholdOptions(module.channelThreshold))
      )
    )
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ar_nuke_role")
          .setPlaceholder("Suppressions de rôles...")
          .addOptions(thresholdOptions(module.roleThreshold))
      )
    )
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ar_nuke_web")
          .setPlaceholder("Créations de webhooks...")
          .addOptions(thresholdOptions(module.webhookThreshold))
      )
    )
  }

  if (selected === "badword") {
    container.addSeparatorComponents((s) => s.setDivider(true))
    container.addTextDisplayComponents((t) => t.setContent(`### ${EMOJI_TAGS.noPaper} Mots interdits (${module.bannedWords.length})`))
    if (module.bannedWords.length > 0) {
      container.addActionRowComponents((row) =>
        row.setComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ar_badword_rm")
            .setPlaceholder("Retirer des mots...")
            .addOptions(module.bannedWords.slice(0, 25).map((w) => ({ label: w, value: w })))
            .setMinValues(1)
            .setMaxValues(Math.min(module.bannedWords.length, 25))
        )
      )
    }
    container.addTextDisplayComponents((t) =>
      t.setContent("> *Ajoutez des mots avec : \`antibadword add <mot>\` ou \`antibadword remove <mot>\`.*")
    )
  }
}

export function buildWhitelistContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.people} 〃 Liste blanche`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `### ${EMOJI_TAGS.addUser} Utilisateurs (${config.whitelistedUsers.length})\n` +
        (config.whitelistedUsers.length > 0
          ? config.whitelistedUsers.map((id) => `> <@${id}>`).join("\n") + "\n"
          : "> *Aucun*\n") +
        `### ${EMOJI_TAGS.cogUser} Rôles (${config.whitelistedRoles.length})\n` +
        (config.whitelistedRoles.length > 0
          ? config.whitelistedRoles.map((id) => `> <@&${id}>`).join("\n") + "\n"
          : "> *Aucun*\n") +
        `### ${EMOJI_TAGS.bot} Bots (${config.whitelistedBots.length})\n` +
        (config.whitelistedBots.length > 0
          ? config.whitelistedBots.map((id) => `> <@${id}>`).join("\n") + "\n"
          : "> *Aucun*\n") +
        `### ${EMOJI_TAGS.channel} Salons (${config.whitelistedChannels.length})\n` +
        (config.whitelistedChannels.length > 0
          ? config.whitelistedChannels.map((id) => `> <#${id}>`).join("\n")
          : "> *Aucun*")
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.add} **Ajouter**`))
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

  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.cancel} **Retirer**`))

  const rmUserOptions = config.whitelistedUsers.slice(0, 25).map((id) => ({ label: `Utilisateur ${id}`, value: id }))
  if (rmUserOptions.length > 0) {
    container.addActionRowComponents((row) =>
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
    container.addActionRowComponents((row) =>
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
    container.addActionRowComponents((row) =>
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
    container.addActionRowComponents((row) =>
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

  return [container]
}

export function buildHoneypotContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.eye} 〃 Honeypot`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Système piège : toute interaction avec un salon ou un rôle piège déclenche une punition automatique.*\n\n` +
        `> ***État:** ${config.honeypot.enabled ? `Activé ${EMOJI_TAGS.enable}` : `Désactivé ${EMOJI_TAGS.disable}`}*\n` +
        `> ${EMOJI_TAGS.gMute} ***Punition:** ${PUNISHMENT_LABELS[config.honeypot.punishment]}*\n` +
        `> ${EMOJI_TAGS.channel} ***Salons pièges:** ${config.honeypot.channels.length > 0 ? config.honeypot.channels.map((id) => `<#${id}>`).join(", ") : "*Aucun*"}*\n` +
        `> ${EMOJI_TAGS.cogUser} ***Rôles pièges:** ${config.honeypot.roles.length > 0 ? config.honeypot.roles.map((id) => `<@&${id}>`).join(", ") : "*Aucun*"}*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent(`**Activation**\n> ${config.honeypot.enabled ? `Activé ${EMOJI_TAGS.enable}` : `Désactivé ${EMOJI_TAGS.disable}`}`))
      .setButtonAccessory((btn) =>
        btn
          .setCustomId(CUSTOM_ID.hpToggle)
          .setEmoji(config.honeypot.enabled ? emoji("disable") : emoji("enable"))
          .setStyle(config.honeypot.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Ajouter un salon piège**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder().setCustomId(CUSTOM_ID.hpChannelAdd).setPlaceholder("Choisir des salons...").setMaxValues(5)
    )
  )
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.cogUser} **Ajouter un rôle piège**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new RoleSelectMenuBuilder().setCustomId(CUSTOM_ID.hpRoleAdd).setPlaceholder("Choisir des rôles...").setMaxValues(5)
    )
  )

  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.gMute} **Punition appliquée aux intrus**`))
  container.addActionRowComponents((row) =>
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
  container.addSeparatorComponents((s) => s.setDivider(true))
  if (config.honeypot.channels.length > 0) {
    container.addActionRowComponents((row) =>
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
    container.addActionRowComponents((row) =>
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

  return [container]
}

export function buildLogsContainer(client: Client, guild: Guild, config: AntiRaidConfig, page = 0, filter?: string): ContainerBuilder[] {
  const events = client.antiraid.getEventLog(guild.id)
  const filtered = filter ? events.filter((e) => e.type === filter) : events
  const perPage = 8
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)
  const slice = filtered.slice(safePage * perPage, (safePage + 1) * perPage)

  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.file} 〃 Journal des événements`))
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

  const filterOptions = ["spam", "mentions", "links", "emojis", "joins", "bots", "nuke", "selfbots", "badword", "honeypot", "lockdown", "other"].map(
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
          .setCustomId(logsNavId("prev", safePage, filter))
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
          .setCustomId(logsNavId("next", safePage, filter))
          .setLabel("▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.channel} **Salon de journalisation**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CUSTOM_ID.logsChannel)
        .setPlaceholder("Choisir le salon de logs...")
        .setMaxValues(1)
    )
  )
  return [container]
}

export function buildModeContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.cog} 〃 Mode automatique`))
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
  return [container]
}

export function buildQuarantineContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.pause} 〃 Quarantaine`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Les utilisateurs placés en quarantaine perdent leurs rôles et permissions.*\n\n` +
        `> ***État:** ${config.quarantine.enabled ? `Activée ${EMOJI_TAGS.enable}` : `Désactivée ${EMOJI_TAGS.disable}`}*\n` +
        `> ${EMOJI_TAGS.cogUser} ***Rôle:** ${config.quarantine.role ? `<@&${config.quarantine.role}>` : "*Auto-créé à la première utilisation*"}*\n` +
        `> ${EMOJI_TAGS.people} ***Utilisateurs:** ${config.quarantine.users.length}*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.addUser} **Ajouter un utilisateur en quarantaine**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new UserSelectMenuBuilder().setCustomId(CUSTOM_ID.qAdd).setPlaceholder("Choisir des utilisateurs...").setMaxValues(5)
    )
  )
  const rmOptions = config.quarantine.users.slice(0, 25).map((id) => ({ label: `Utilisateur ${id}`, value: id }))
  if (rmOptions.length > 0) {
    container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.cancel} **Retirer de la quarantaine**`))
    container.addActionRowComponents((row) =>
      row.setComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_ID.qRm)
          .setPlaceholder("Retirer des utilisateurs...")
          .addOptions(rmOptions)
          .setMinValues(1)
          .setMaxValues(Math.min(rmOptions.length, 25))
      )
    )
  }
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Vider la quarantaine**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.qClear).setEmoji(emoji("loop")).setStyle(ButtonStyle.Danger))
  )
  return [container]
}

export function buildLockdownContainer(client: Client, guild: Guild, config: AntiRaidConfig): ContainerBuilder[] {
  const raidActive = config.raidMode && Date.now() < config.raidEndsAt
  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${EMOJI_TAGS.light} 〃 Lockdown`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `### État\n> ***Lockdown:** ${raidActive ? `Actif ${EMOJI_TAGS.light}` : "Inactif"}*\n` +
        (raidActive ? `> ***Jusqu'à:** <t:${Math.floor(config.raidEndsAt / 1000)}:T>*\n` : "") +
        `> ${EMOJI_TAGS.duration} ***Slowmode global:** ${config.lockdown.slowmode > 0 ? formatTime(config.lockdown.slowmode) : "Désactivé"}*\n` +
        `> ${EMOJI_TAGS.noPaper} ***Blocage des messages:** ${config.lockdown.blockMessages ? `Activé ${EMOJI_TAGS.enable}` : `Désactivé ${EMOJI_TAGS.disable}`}*\n` +
        `> ${EMOJI_TAGS.addUser} ***Blocage des arrivées:** ${config.lockdown.blockJoins ? `Activé ${EMOJI_TAGS.enable}` : `Désactivé ${EMOJI_TAGS.disable}`}*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Activer le verrouillage**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.lockdownOn).setEmoji(emoji("enable")).setStyle(ButtonStyle.Success))
  )
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Désactiver le verrouillage**"))
      .setButtonAccessory((btn) => btn.setCustomId(CUSTOM_ID.lockdownOff).setEmoji(emoji("disable")).setStyle(ButtonStyle.Danger))
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addTextDisplayComponents((t) => t.setContent(`${EMOJI_TAGS.duration} **Durée du verrouillage**`))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_ID.lockdownDur)
        .setPlaceholder("Choisir la durée...")
        .addOptions(["10m", "30m", "1h", "6h", "12h", "24h"].map((value) => ({ label: value, value })))
    )
  )
  return [container]
}

export async function handleModuleInteraction(client: Client, interaction: Interaction, moduleName: ModuleName): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ar_")) return false

  const moduleSuffix = `_${moduleName}`
  const genericMatch = /^ar_mod_(toggle|punish|limit|interval|duration)_/.exec(customId)
  if (genericMatch && !customId.endsWith(moduleSuffix)) return false

  const specificPrefixes: Record<string, string> = {
    mentions: "ar_mentions_",
    links: "ar_links_",
    nuke: "ar_nuke_",
    badword: "ar_badword_",
  }
  const prefix = specificPrefixes[moduleName]
  if (prefix && !genericMatch && !customId.startsWith(prefix)) return false
  if (!genericMatch && !prefix) return false

  if (!(await requireAdmin(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false
  const get = async () => client.antiraid.getConfig(guild.id)
  const refresh = async () => {
    const fresh = await get()
    await updatePanel(interaction, buildModuleContainer(client, guild, fresh, moduleName))
  }

  if (genericMatch) {
    const action = genericMatch[1]
    if (action === "toggle") {
      const current = await get()
      const enabled = !current.modules[moduleName].enabled
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { [`modules.${moduleName}.enabled`]: enabled, mode: "custom" } },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }

    if (action === "punish" && interaction.isStringSelectMenu()) {
      const value = interaction.values[0] as Punishment
      if (PUNISHMENTS.includes(value)) {
        let duration = (await get()).modules[moduleName].duration
        if ((value === "timeout" || value === "lockdown") && duration <= 0) duration = 600000
        if (value !== "timeout" && value !== "lockdown") duration = 0
        await AntiRaid.findOneAndUpdate(
          { guildId: guild.id },
          {
            $set: {
              [`modules.${moduleName}.punishment`]: value,
              [`modules.${moduleName}.duration`]: duration,
              mode: "custom",
            },
          },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(guild.id)
        await refresh()
      }
      return true
    }

    if (action === "limit" && interaction.isStringSelectMenu()) {
      const value = interaction.values[0]
      const current = await get()
      const base = current.modules[moduleName].limit
      const next =
        value === "limit2" ? Math.max(1, Math.round(base * 2)) : value === "limitHalf" ? Math.max(1, Math.round(base / 2)) : base
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { [`modules.${moduleName}.limit`]: next, mode: "custom" } },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }

    if (action === "interval" && interaction.isStringSelectMenu()) {
      const parsed = parseTime(interaction.values[0])
      if (parsed !== null) {
        await AntiRaid.findOneAndUpdate(
          { guildId: guild.id },
          { $set: { [`modules.${moduleName}.interval`]: parsed, mode: "custom" } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(guild.id)
        await refresh()
      }
      return true
    }

    if (action === "duration" && interaction.isStringSelectMenu()) {
      const parsed = parseTime(interaction.values[0])
      if (parsed !== null) {
        await AntiRaid.findOneAndUpdate(
          { guildId: guild.id },
          { $set: { [`modules.${moduleName}.duration`]: parsed, mode: "custom" } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(guild.id)
        await refresh()
      }
      return true
    }
  }

  if (moduleName === "mentions") {
    if (customId === "ar_mentions_maxuser" && interaction.isStringSelectMenu()) {
      const value = Number(interaction.values[0])
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { "modules.mentions.maxUserMentions": value, mode: "custom" } },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }
    if (customId === "ar_mentions_maxrole" && interaction.isStringSelectMenu()) {
      const value = Number(interaction.values[0])
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { "modules.mentions.maxRoleMentions": value, mode: "custom" } },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }
    if (customId === "ar_mentions_everyone") {
      const current = await get()
      const allow = !current.modules.mentions.allowEveryone
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { "modules.mentions.allowEveryone": allow, mode: "custom" } },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }
  }

  if (moduleName === "links") {
    if (customId === "ar_links_invites") {
      const current = await get()
      const block = !current.modules.links.blockDiscordInvites
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { "modules.links.blockDiscordInvites": block, mode: "custom" } },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }
    if ((customId === "ar_links_allowrm" || customId === "ar_links_blockrm") && interaction.isStringSelectMenu()) {
      const field = customId === "ar_links_allowrm" ? "modules.links.allowedDomains" : "modules.links.blockedDomains"
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $pullAll: { [field]: interaction.values } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }
  }

  if (moduleName === "nuke" && interaction.isStringSelectMenu()) {
    const map: Record<string, string> = {
      ar_nuke_chan: "channelThreshold",
      ar_nuke_role: "roleThreshold",
      ar_nuke_web: "webhookThreshold",
    }
    const key = map[customId]
    if (key) {
      const value = Number(interaction.values[0])
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { [`modules.nuke.${key}`]: value, mode: "custom" } },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }
  }

  if (moduleName === "badword" && interaction.isStringSelectMenu() && customId === "ar_badword_rm") {
    await AntiRaid.findOneAndUpdate(
      { guildId: guild.id },
      { $pullAll: { "modules.badword.bannedWords": interaction.values } },
      { upsert: true }
    )
    client.antiraid.invalidateConfig(guild.id)
    await refresh()
    return true
  }

  return true
}

export async function handleWhitelistInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ar_wl_")) return false
  if (!(await requireAdmin(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false
  const get = async () => client.antiraid.getConfig(guild.id)
  const refresh = async () => {
    const fresh = await get()
    await updatePanel(interaction, buildWhitelistContainer(client, guild, fresh))
  }

  if (interaction.isStringSelectMenu()) {
    const rm = customId.match(/^ar_wl_(user|role|bot|channel)_rm$/)
    if (rm) {
      const type = rm[1]
      const field =
        type === "user" ? "whitelistedUsers" : type === "role" ? "whitelistedRoles" : type === "bot" ? "whitelistedBots" : "whitelistedChannels"
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $pullAll: { [field]: interaction.values } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }
  }

  if (interaction.isUserSelectMenu() && (customId === CUSTOM_ID.wlUserAdd || customId === CUSTOM_ID.wlBotAdd)) {
    const field = customId === CUSTOM_ID.wlUserAdd ? "whitelistedUsers" : "whitelistedBots"
    const ids = interaction.values.filter((id) => id !== client.user?.id)
    await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { [field]: { $each: ids } } }, { upsert: true })
    client.antiraid.invalidateConfig(guild.id)
    await refresh()
    return true
  }

  if (interaction.isRoleSelectMenu() && customId === CUSTOM_ID.wlRoleAdd) {
    const ids = interaction.values
    await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { whitelistedRoles: { $each: ids } } }, { upsert: true })
    client.antiraid.invalidateConfig(guild.id)
    await refresh()
    return true
  }

  if (interaction.isChannelSelectMenu() && customId === CUSTOM_ID.wlChannelAdd) {
    const ids = interaction.values
    await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { whitelistedChannels: { $each: ids } } }, { upsert: true })
    client.antiraid.invalidateConfig(guild.id)
    await refresh()
    return true
  }

  return true
}

export async function handleHoneypotInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ar_hp_")) return false
  if (!(await requireAdmin(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false
  const get = async () => client.antiraid.getConfig(guild.id)
  const refresh = async () => {
    const fresh = await get()
    await updatePanel(interaction, buildHoneypotContainer(client, guild, fresh))
  }

  if (customId === CUSTOM_ID.hpToggle) {
    const current = await get()
    const enabled = !current.honeypot.enabled
    await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $set: { "honeypot.enabled": enabled } }, { upsert: true })
    client.antiraid.invalidateConfig(guild.id)
    await refresh()
    return true
  }

  if (customId === CUSTOM_ID.hpPunish && interaction.isStringSelectMenu()) {
    const value = interaction.values[0] as Punishment
    if (PUNISHMENTS.includes(value)) {
      let duration = (await get()).honeypot.duration
      if ((value === "timeout" || value === "lockdown") && duration <= 0) duration = 600000
      if (value !== "timeout" && value !== "lockdown") duration = 0
      await AntiRaid.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { "honeypot.punishment": value, "honeypot.duration": duration } },
        { upsert: true }
      )
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
    }
    return true
  }

  if (interaction.isStringSelectMenu()) {
    const rm = customId.match(/^ar_hp_(channel|role)_rm$/)
    if (rm) {
      const field = rm[1] === "channel" ? "honeypot.channels" : "honeypot.roles"
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $pullAll: { [field]: interaction.values } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
      return true
    }
  }

  if (interaction.isChannelSelectMenu() && customId === CUSTOM_ID.hpChannelAdd) {
    const ids = interaction.values
    await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { "honeypot.channels": { $each: ids } } }, { upsert: true })
    client.antiraid.invalidateConfig(guild.id)
    await refresh()
    return true
  }

  if (interaction.isRoleSelectMenu() && customId === CUSTOM_ID.hpRoleAdd) {
    const ids = interaction.values
    await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $addToSet: { "honeypot.roles": { $each: ids } } }, { upsert: true })
    client.antiraid.invalidateConfig(guild.id)
    await refresh()
    return true
  }

  return true
}

export async function handleLogsInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ar_logs_")) return false
  if (!(await requireAdmin(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false
  const get = async () => client.antiraid.getConfig(guild.id)
  const refresh = async (page = 0, filter?: string) => {
    const fresh = await get()
    await updatePanel(interaction, buildLogsContainer(client, guild, fresh, page, filter))
  }
  const navMatch = /^ar_logs_(prev|next)_(\d+)_(.+)$/.exec(customId)
  if (navMatch) {
    const dir = navMatch[1]
    const current = Number(navMatch[2])
    const filter = navMatch[3] === "all" ? undefined : navMatch[3]
    const next = dir === "prev" ? Math.max(0, current - 1) : current + 1
    await refresh(next, filter)
    return true
  }

  if (customId === CUSTOM_ID.logsFilter && interaction.isStringSelectMenu()) {
    await refresh(0, interaction.values[0])
    return true
  }

  if (customId === CUSTOM_ID.logsChannel && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0]
    await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $set: { logChannel: channelId } }, { upsert: true })
    client.antiraid.invalidateConfig(guild.id)
    await refresh()
    return true
  }

  return true
}

export async function handleModeInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  if (interaction.customId !== CUSTOM_ID.modeSel) return false
  if (!(await requireAdmin(interaction))) return true
  if (!interaction.isStringSelectMenu()) return true

  const guild = interaction.guild
  if (!guild) return false
  const value = interaction.values[0]
  if (MODES.includes(value as (typeof MODES)[number])) {
    await client.antiraid.applyMode(client, guild.id, value as (typeof MODES)[number])
    const fresh = await client.antiraid.getConfig(guild.id)
    await updatePanel(interaction, buildModeContainer(client, guild, fresh))
  }
  return true
}

export async function handleQuarantineInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ar_q_")) return false
  if (!(await requireAdmin(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false
  const get = async () => client.antiraid.getConfig(guild.id)
  const refresh = async () => {
    const fresh = await get()
    await updatePanel(interaction, buildQuarantineContainer(client, guild, fresh))
  }

  if (customId === CUSTOM_ID.qAdd && interaction.isUserSelectMenu()) {
    for (const id of interaction.values) {
      await client.antiraid.quarantineUser(client, guild, id)
    }
    await refresh()
    return true
  }

  if (customId === CUSTOM_ID.qRm && interaction.isStringSelectMenu()) {
    for (const id of interaction.values) {
      await client.antiraid.unquarantineUser(client, guild, id)
    }
    await refresh()
    return true
  }

  if (customId === CUSTOM_ID.qClear) {
    for (const id of (await get()).quarantine.users) {
      await client.antiraid.unquarantineUser(client, guild, id)
    }
    await refresh()
    return true
  }

  return true
}

export async function handleLockdownInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ar_lockdown_")) return false
  if (!(await requireAdmin(interaction))) return true

  const guild = interaction.guild
  if (!guild) return false
  const config = await client.antiraid.getConfig(guild.id)
  const refresh = async () => {
    const fresh = await client.antiraid.getConfig(guild.id)
    await updatePanel(interaction, buildLockdownContainer(client, guild, fresh))
  }

  if (customId === CUSTOM_ID.lockdownOn) {
    await client.antiraid.activateRaidMode(client, config, config.raidDuration)
    await refresh()
    return true
  }
  if (customId === CUSTOM_ID.lockdownOff) {
    await client.antiraid.deactivateRaidMode(client, config)
    await refresh()
    return true
  }
  if (customId === CUSTOM_ID.lockdownDur && interaction.isStringSelectMenu()) {
    const duration = parseTime(interaction.values[0])
    if (duration !== null) {
      await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $set: { raidDuration: duration } }, { upsert: true })
      client.antiraid.invalidateConfig(guild.id)
      await refresh()
    }
    return true
  }

  return true
}

export async function handlePanelInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent()) return false
  if (!interaction.inGuild()) return false
  const customId = interaction.customId
  if (!customId.startsWith("ar_")) return false

  const moduleMatches = MODULES.filter((name) => {
    const suffix = `_${name}`
    if (new RegExp(`^ar_mod_(toggle|punish|limit|interval|duration)_${name}$`).test(customId)) return true
    const prefixes: Record<string, string> = {
      mentions: "ar_mentions_",
      links: "ar_links_",
      nuke: "ar_nuke_",
      badword: "ar_badword_",
    }
    return prefixes[name] !== undefined && customId.startsWith(prefixes[name])
  })

  for (const name of moduleMatches) {
    if (await handleModuleInteraction(client, interaction, name)) return true
  }

  if (customId.startsWith("ar_wl_")) return handleWhitelistInteraction(client, interaction)
  if (customId.startsWith("ar_hp_")) return handleHoneypotInteraction(client, interaction)
  if (customId.startsWith("ar_logs_")) return handleLogsInteraction(client, interaction)
  if (customId === CUSTOM_ID.modeSel) return handleModeInteraction(client, interaction)
  if (customId.startsWith("ar_q_")) return handleQuarantineInteraction(client, interaction)
  if (customId.startsWith("ar_lockdown_")) return handleLockdownInteraction(client, interaction)

  return false
}
