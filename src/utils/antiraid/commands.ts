import type { Client, Message } from "discord.js"
import { EmbedBuilder } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../errorEmbed.js"
import formatTime from "../formatTime.js"
import parseTime from "../parseTime.js"
import { buildAntiRaidEmbed, sendLog } from "./logs.js"
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
  type AntiRaidMode,
  type ModuleName,
  type Punishment,
} from "./schema.js"

const HELP_LINES = [
  "`antiraid` — Ouvre le dashboard interactif.",
  "`antiraid help` — Affiche cette aide.",
  "`antiraid enable|disable` — Active ou désactive la protection.",
  "`antiraid status` — État global détaillé du système.",
  "`antiraid status detailed` — Statut avancé (suspects, timeline).",
  "`antiraid mode <off|low|balanced|high|maximum|custom>` — Mode automatique.",
  "`antiraid config` — Menu interactif complet.",
  "`antiraid spam <enable|disable|threshold <n>|interval <durée>|action <punition>>` — Anti-spam.",
  "`antiraid raid <enable|disable|threshold <n>|interval <durée>|action <punition>>` — Anti-flood de membres.",
  "`antiraid nuke <channelDelete|roleDelete|webhookCreate> <threshold <n>|action <punition>>` — Anti-nuke.",
  "`antiraid mentions <maxUserMentions <n>|maxRoleMentions <n>|allowEveryone <on|off>|action <punition>>` — Anti-mention.",
  "`antiraid links <blockDiscordInvites <on|off>|allowedDomains <ajout|list>|blockedDomains <ajout|list>|action <punition>>` — Filtrage liens.",
  "`antiraid invites <delete|warn|timeout|kick>` — Bloque les invitations Discord.",
  "`antiraid whitelist <user|role|bot|channel> <add|remove> <cible>` — Gère la liste blanche.",
  "`antiraid honeypot <enable|disable|add channel|remove channel|add role|remove role|action <punition>>` — Système piège.",
  "`antiraid lockdown <on|off|timed <durée>>` — Verrouillage du serveur.",
  "`antiraid panic` — Déclenche le mode urgence critique.",
  "`antiraid panic disable` — Restaure l'état précédent.",
  "`antiraid quarantine <add <@user>|remove <@user>|list|clear>` — Gestion de la quarantaine.",
  "`antiraid logs [filtre]` — Journal de sécurité paginé.",
  "`antiraid test` — Simulation sans action réelle.",
  "`antiraid debug` — Mode debug (score de risque, décisions).",
  "`antiraid restore <channel|role|permissions> <id>` — Restauration manuelle.",
  "`antiraid allow <user|role|bot|channel> <cible>` — Whitelist rapide.",
  "`antiraid deny <user|role|bot|channel> <cible>` — Retire la whitelist.",
  "`antiraid audit` — Audit de sécurité du serveur.",
  "`antiraid simulate raid|nuke` — Simulation d'attaque.",
  "`antiraid protect` — Auto-durcissement du serveur.",
  "`antiraid report` — Rapport de sécurité complet.",
  "`antiraid reset` — Réinitialise toute la configuration.",
]

const PUNISHMENT_USAGE = PUNISHMENTS.map((p) => `\`${p}\``).join(", ")

function resolveModuleName(raw: string): ModuleName | null {
  const name = raw.toLowerCase() as ModuleName
  return MODULES.includes(name) ? name : null
}

function buildModuleLine(config: AntiRaidConfig, name: ModuleName): string {
  const module = config.modules[name]
  const premiumTag = PREMIUM_MODULES.includes(name) ? " 🔒" : ""
  const state = module.enabled ? "✅" : "❌"
  const threshold = module.interval > 0 ? `\`${module.limit}\` / \`${formatTime(module.interval)}\`` : "`comportement`"
  const detail = module.enabled
    ? `**${PUNISHMENT_LABELS[module.punishment]}** — seuil ${threshold}`
    : "désactivé"
  return `> ${state} \`${name}\`${premiumTag} — **${MODULE_LABELS[name]}** — ${detail}`
}

function buildOverviewEmbed(client: Client, message: Message, config: AntiRaidConfig, detailed = false): EmbedBuilder {
  const status = config.enabled ? "✅ **Activé**" : "❌ **Désactivé**"
  const raidActive = config.raidMode && Date.now() < config.raidEndsAt
  const panicActive = config.panic.active && Date.now() < config.panic.until
  const raid = raidActive
    ? `🔒 **Actif** (jusqu'à <t:${Math.floor(config.raidEndsAt / 1000)}:T>)`
    : "⭕ **Inactif**"
  const log = config.logChannel ? `<#${config.logChannel}>` : "`Aucun`"
  const premium = config.premium ? "✅ **Premium**" : "❌ **Standard**"
  const premiumNotice = config.premium
    ? ""
    : "\n> *🔒 = module premium — activez le premium pour l'utiliser.*"
  const threat = client.antiraid.getThreatLevel(message.guild!.id)

  const moduleLines = MODULES.map((name) => buildModuleLine(config, name)).join("\n")

  let extra = ""
  if (detailed) {
    const suspects = client.antiraid.getTopSuspects(message.guild!.id, 5)
    const events = client.antiraid.getEventLog(message.guild!.id)
    const lastEvents = events
      .slice(-5)
      .map((e) => `> \`${e.type}\` — ${e.detail ?? "..."} (<t:${Math.floor(e.ts / 1000)}:R>)`)
      .join("\n")
    extra =
      `\n\n### \`🔍\` Suspects\n` +
      (suspects.length > 0
        ? suspects.map((s) => `> <@${s.userId}> — score \`${s.score}\``).join("\n")
        : "> *Aucun suspect détecté.*") +
      `\n\n### \`🧾\` Derniers événements\n` +
      (lastEvents || "> *Aucun événement.*")
  }

  return new EmbedBuilder()
    .setTitle(" ")
    .setDescription(
      `# \`🛡️\` 〃 Anti-Raid\n` +
        `> *Protection anti-raid configurable par serveur.*\n\n` +
        `### \`📊\` Statut\n` +
        `> ***Anti-Raid:** ${status}*\n` +
        `> ***Mode:** ${MODE_LABELS[config.mode]}*\n` +
        `> ***Menace:** \`${threat}/100\`*\n` +
        `> ***Mode raid:** ${raid}*\n` +
        `> ***Panic:** ${panicActive ? "💣 **Actif**" : "⭕ **Inactif**"}*\n` +
        `> ***Journal:** ${log}*\n` +
        `> ***Compte:** ${premium}*\n\n` +
        `### \`🧩\` Modules\n` +
        moduleLines +
        `${premiumNotice}\n\n` +
        `### \`👥\` Whitelist\n` +
        `> ***Utilisateurs:** ${config.whitelistedUsers.length}*\n` +
        `> ***Rôles:** ${config.whitelistedRoles.length}*\n` +
        `> ***Bots:** ${config.whitelistedBots.length}*\n` +
        `> ***Salons:** ${config.whitelistedChannels.length}*\n\n` +
        `### \`🕳️\` Honeypot\n` +
        `> ***État:** ${config.honeypot.enabled ? "Activé ✅" : "Désactivé ❌"}*\n` +
        `> ***Salons pièges:** ${config.honeypot.channels.length}*\n` +
        `> ***Rôles pièges:** ${config.honeypot.roles.length}*\n\n` +
        `### \`🛂\` Quarantaine\n` +
        `> ***État:** ${config.quarantine.enabled ? "Activée ✅" : "Désactivée ❌"}*\n` +
        `> ***Utilisateurs:** ${config.quarantine.users.length}*` +
        extra
    )
    .setFooter({ text: message.author.tag, iconURL: message.author.displayAvatarURL() })
}

async function saveModule(guildId: string, name: ModuleName, patch: Record<string, unknown>, markCustom = true) {
  const update: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    update[`modules.${name}.${key}`] = value
  }
  if (markCustom) update["mode"] = "custom"
  await AntiRaid.findOneAndUpdate({ guildId }, { $set: update }, { upsert: true })
}

function requireModule(name: string | undefined): ModuleName | null {
  return name ? resolveModuleName(name) : null
}

export async function routeAntiraid(client: Client, message: Message, args: string[], config: AntiRaidConfig) {
  const sub = args[0]?.toLowerCase()

  if (!sub || sub === "status") {
    return message.reply({ embeds: [buildOverviewEmbed(client, message, config)] })
  }

  switch (sub) {
    case "help":
      return message.reply({
        embeds: [buildAntiRaidEmbed("❓", "Aide anti-raid", HELP_LINES.map((line) => `> ${line}`).join("\n"), colors.yel)],
      })

    case "status":
      if (args[1]?.toLowerCase() === "detailed") {
        return message.reply({ embeds: [buildOverviewEmbed(client, message, config, true)] })
      }
      return message.reply({ embeds: [buildOverviewEmbed(client, message, config)] })

    case "on":
    case "enable": {
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { enabled: true } }, { upsert: true })
      client.antiraid.invalidateConfig(message.guild!.id)
      await sendLog(
        client,
        message.guild!.id,
        buildAntiRaidEmbed("✅", "Anti-Raid activé", `> ***Par:** <@${message.author.id}>*\n> *La protection anti-raid est maintenant **activée**.*`)
      )
      return message.reply({
        embeds: [buildAntiRaidEmbed("✅", "Anti-Raid activé", "> *La protection anti-raid est maintenant **activée** sur ce serveur.*")],
      })
    }

    case "off":
    case "disable": {
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { enabled: false } }, { upsert: true })
      client.antiraid.invalidateConfig(message.guild!.id)
      await sendLog(
        client,
        message.guild!.id,
        buildAntiRaidEmbed("⏹️", "Anti-Raid désactivé", `> ***Par:** <@${message.author.id}>*`, colors.yel)
      )
      return message.reply({
        embeds: [buildAntiRaidEmbed("⏹️", "Anti-Raid désactivé", "> *La protection anti-raid est maintenant **désactivée** sur ce serveur.*", colors.yel)],
      })
    }

    case "mode": {
      const mode = args[1]?.toLowerCase() as AntiRaidMode
      if (!MODES.includes(mode)) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", `> *Mode inconnu. Modes disponibles : \`${MODES.join("`, `")}\`.*`)],
        })
      }
      await client.antiraid.applyMode(client, message.guild!.id, mode)
      await sendLog(
        client,
        message.guild!.id,
        buildAntiRaidEmbed("🧠", "Mode mis à jour", `> ***Par:** <@${message.author.id}>*\n> ***Mode:** ${MODE_LABELS[mode]}*`, colors.yel)
      )
      return message.reply({
        embeds: [buildAntiRaidEmbed("🧠", "Mode mis à jour", `> *Le mode \`${MODE_LABELS[mode]}\` a été appliqué (seuils automatiques, réglages custom conservés).*`, colors.yel)],
      })
    }

    case "config":
      return message.reply({ embeds: [buildAntiRaidEmbed("⚙️", "Configuration", "> *Utilisez `antiraid` sans argument pour ouvrir le dashboard interactif, ou une des commandes de configuration ci-dessous.*\n\n" + HELP_LINES.slice(0, 13).map((line) => `> ${line}`).join("\n"), colors.yel)] })

    case "spam":
    case "raid":
    case "nuke":
    case "mentions":
    case "links":
    case "invites":
      return handleModuleSubcommand(client, message, args, config, sub)

    case "whitelist":
      return handleWhitelist(client, message, args)

    case "allow":
      return handleAllow(client, message, args, false)

    case "deny":
      return handleAllow(client, message, args, true)

    case "honeypot":
      return handleHoneypot(client, message, args, config)

    case "lockdown":
    case "raidmode":
      return handleLockdown(client, message, args, config)

    case "panic":
      return handlePanic(client, message, args, config)

    case "quarantine":
      return handleQuarantine(client, message, args, config)

    case "logs":
      return handleLogs(client, message, args, config)

    case "test":
      return handleTest(client, message)

    case "debug":
      return handleDebug(client, message)

    case "restore":
      return handleRestore(client, message, args)

    case "audit":
      return handleAudit(client, message)

    case "simulate":
      return handleSimulate(client, message, args, config)

    case "protect":
      return handleProtect(client, message, config)

    case "report":
      return handleReport(client, message, config)

    case "reset":
      return handleReset(client, message)

    case "verifyrole": {
      const role = message.mentions.roles.first()
      const raw = args[1]?.toLowerCase()
      const roleId = role ? role.id : raw && raw !== "off" && raw !== "none" ? (args[1] as string) : null
      if (!roleId && raw !== "off" && raw !== "none") {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle ou utilisez `antiraid verifyrole off`.*")],
        })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.verify.role": roleId } }, { upsert: true })
      client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "✅",
            "Rôle de vérification mis à jour",
            roleId ? `> *Le rôle **<@&${roleId}>** sera attribué après vérification.*` : "> *Aucun rôle ne sera attribué après vérification.*"
          ),
        ],
      })
    }

    case "log": {
      const channel = message.mentions.channels.first()
      const raw = args[1]?.toLowerCase()
      const channelId = channel ? channel.id : raw && raw !== "off" && raw !== "none" ? (args[1] as string) : null
      if (!channelId && raw !== "off" && raw !== "none") {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un salon ou utilisez `antiraid log off`.*")],
        })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { logChannel: channelId } }, { upsert: true })
      client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "✅",
            "Journal mis à jour",
            channelId
              ? `> *Les événements anti-raid seront journalisés dans <#${channelId}>.*`
              : "> *La journalisation est désactivée.*"
          ),
        ],
      })
    }

    default:
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", `> *Sous-commande inconnue : \`${sub}\`. Utilisez \`antiraid help\`.*`)],
      })
  }
}

async function handleModuleSubcommand(client: Client, message: Message, args: string[], config: AntiRaidConfig, moduleKey: string) {
  const guildId = message.guild!.id
  const action = args[1]?.toLowerCase()
  const value = args[2]?.toLowerCase()

  if (moduleKey === "invites") {
    const punishment: string = action ?? ""
    if (!["delete", "warn", "timeout", "kick", "ban"].includes(punishment)) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid invites <delete|warn|timeout|kick|ban>`.*")],
      })
    }
    const mapped: Punishment = (punishment === "delete" ? "none" : punishment) as Punishment
    await saveModule(guildId, "links", { blockDiscordInvites: true, punishment: mapped, enabled: true })
    client.antiraid.invalidateConfig(guildId)
    const label = mapped === "none" ? "Suppression du message" : PUNISHMENT_LABELS[mapped]
    return message.reply({
      embeds: [buildAntiRaidEmbed("✅", "Invitations bloquées", `> *Les invitations Discord seront **supprimées** et l'auteur sanctionné : ${label}.*`)],
    })
  }

  if (action === "enable" || action === "disable") {
    const enabled = action === "enable"
    await saveModule(guildId, moduleKey as ModuleName, { enabled })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "✅",
          "Module mis à jour",
          `> ***Module:** ${MODULE_LABELS[moduleKey as ModuleName]} (\`${moduleKey}\`)*\n> ***État:** ${enabled ? "Activé" : "Désactivé"}*`
        ),
      ],
    })
  }

  if (action === "threshold" || action === "limit") {
    const count = Number(args[2])
    if (!Number.isInteger(count) || count < 1) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Le nombre d'actions doit être un entier supérieur ou égal à 1.*")],
      })
    }
    await saveModule(guildId, moduleKey as ModuleName, { limit: count })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "✅",
          "Seuil mis à jour",
          `> ***Module:** ${MODULE_LABELS[moduleKey as ModuleName]}*\n> ***Seuil:** \`${count}\` actions*`
        ),
      ],
    })
  }

  if (action === "interval") {
    const interval = parseTime(args[2] ?? "")
    if (interval === null || interval <= 0) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemples : `5s`, `10m`, `1h`.*")],
      })
    }
    await saveModule(guildId, moduleKey as ModuleName, { interval })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "✅",
          "Intervalle mis à jour",
          `> ***Module:** ${MODULE_LABELS[moduleKey as ModuleName]}*\n> ***Intervalle:** \`${formatTime(interval)}\`*`
        ),
      ],
    })
  }

  if (action === "action" || action === "punish") {
    const punishment = value as Punishment
    if (!PUNISHMENTS.includes(punishment)) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", `> *Punition inconnue. Punitions disponibles : ${PUNISHMENT_USAGE}.*`)],
      })
    }
    let duration = config.modules[moduleKey as ModuleName].duration
    if ((punishment === "timeout" || punishment === "lockdown") && duration <= 0) duration = 600000
    if (punishment !== "timeout" && punishment !== "lockdown") duration = 0
    await saveModule(guildId, moduleKey as ModuleName, { punishment, duration })
    client.antiraid.invalidateConfig(guildId)
    const durationText =
      duration > 0 && (punishment === "timeout" || punishment === "lockdown")
        ? ` (durée : \`${formatTime(duration)}\`)`
        : ""
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "✅",
          "Punition mise à jour",
          `> ***Module:** ${MODULE_LABELS[moduleKey as ModuleName]}*\n> ***Punition:** **${PUNISHMENT_LABELS[punishment]}**${durationText}*`
        ),
      ],
    })
  }

  if (moduleKey === "nuke") {
    const target = action as string
    if (target === "channeldelete" || target === "channelDelete") {
      const count = Number(args[2])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid nuke channelDelete <threshold|action>`.*")] })
      }
      await saveModule(guildId, "nuke", { channelThreshold: count })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({
        embeds: [buildAntiRaidEmbed("✅", "Seuil anti-nuke mis à jour", `> ***Suppression de salons:** seuil \`${count}\`.*`)],
      })
    }
    if (target === "roledelete" || target === "roleDelete") {
      const count = Number(args[2])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid nuke roleDelete <threshold|action>`.*")] })
      }
      await saveModule(guildId, "nuke", { roleThreshold: count })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({
        embeds: [buildAntiRaidEmbed("✅", "Seuil anti-nuke mis à jour", `> ***Suppression de rôles:** seuil \`${count}\`.*`)],
      })
    }
    if (target === "webhookcreate" || target === "webhookCreate") {
      const count = Number(args[2])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid nuke webhookCreate <threshold|action>`.*")] })
      }
      await saveModule(guildId, "nuke", { webhookThreshold: count })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({
        embeds: [buildAntiRaidEmbed("✅", "Seuil anti-nuke mis à jour", `> ***Création de webhooks:** seuil \`${count}\`.*`)],
      })
    }
  }

  if (moduleKey === "mentions") {
    if (action === "maxusernentions" || action === "maxUserMentions") {
      const count = Number(args[2])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid mentions maxUserMentions <nombre>`.*")] })
      }
      await saveModule(guildId, "mentions", { maxUserMentions: count })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Mentions", `> ***Max mentions utilisateur par message:** \`${count}\`.*`)] })
    }
    if (action === "maxrolementions" || action === "maxRoleMentions") {
      const count = Number(args[2])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid mentions maxRoleMentions <nombre>`.*")] })
      }
      await saveModule(guildId, "mentions", { maxRoleMentions: count })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Mentions", `> ***Max mentions rôle par message:** \`${count}\`.*`)] })
    }
    if (action === "alloweveryone" || action === "allowEveryone") {
      if (value !== "on" && value !== "off") {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid mentions allowEveryone <on|off>`.*")] })
      }
      await saveModule(guildId, "mentions", { allowEveryone: value === "on" })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Mentions", `> *Mention @everyone/${"@here"} : ${value === "on" ? "autorisée ✅" : "bloquée ❌"}.*`)] })
    }
  }

  if (moduleKey === "links") {
    if (action === "blockdiscordinvites" || action === "blockDiscordInvites") {
      if (value !== "on" && value !== "off") {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid links blockDiscordInvites <on|off>`.*")] })
      }
      await saveModule(guildId, "links", { blockDiscordInvites: value === "on" })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Liens", `> *Blocage des invitations Discord : ${value === "on" ? "activé ✅" : "désactivé ❌"}.*`)] })
    }
    if (action === "alloweddomains" || action === "allowedDomains" || action === "alloweddomain") {
      const domain = args[2]?.toLowerCase()
      if (!domain) {
        const list = config.modules.links.allowedDomains
        return message.reply({
          embeds: [buildAntiRaidEmbed("🌐", "Domaines autorisés", list.length > 0 ? `> ${list.map((d) => `\`${d}\``).join(", ")}` : "> *Aucun.*", colors.yel)],
        })
      }
      const clean = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
      await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { "modules.links.allowedDomains": clean } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Domaines autorisés", `> *\`${clean}\` ajouté à la liste blanche des domaines.*`)] })
    }
    if (action === "blockeddomains" || action === "blockedDomains" || action === "blockeddomain") {
      const domain = args[2]?.toLowerCase()
      if (!domain) {
        const list = config.modules.links.blockedDomains
        return message.reply({
          embeds: [buildAntiRaidEmbed("🌐", "Domaines bloqués", list.length > 0 ? `> ${list.map((d) => `\`${d}\``).join(", ")}` : "> *Aucun.*", colors.yel)],
        })
      }
      const clean = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
      await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { "modules.links.blockedDomains": clean } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Domaines bloqués", `> *\`${clean}\` ajouté à la liste noire des domaines.*`)] })
    }
  }

  return message.reply({
    embeds: [
      buildErrorEmbed(
        "400 Bad Request",
        `> *Sous-action inconnue pour \`${moduleKey}\`. Utilisez \`antiraid help\`.*`
      ),
    ],
  })
}

async function handleWhitelist(client: Client, message: Message, args: string[]) {
  const guildId = message.guild!.id
  const type = args[1]?.toLowerCase()
  const action = args[2]?.toLowerCase()
  const target = args[3]

  if (!["user", "role", "bot", "channel"].includes(type ?? "")) {
    return message.reply({
      embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid whitelist <user|role|bot|channel> <add|remove> <cible>`.*")],
    })
  }
  if (action !== "add" && action !== "remove") {
    return message.reply({
      embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid whitelist <type> <add|remove> <cible>`.*")],
    })
  }

  const field =
    type === "user" ? "whitelistedUsers" : type === "role" ? "whitelistedRoles" : type === "bot" ? "whitelistedBots" : "whitelistedChannels"

  let id: string | null = null
  if (type === "user" || type === "bot") {
    const user = message.mentions.users.first()
    id = user?.id ?? target ?? null
  } else if (type === "role") {
    const role = message.mentions.roles.first()
    id = role?.id ?? target ?? null
  } else {
    const channel = message.mentions.channels.first()
    id = channel?.id ?? target ?? null
  }

  if (!id) {
    return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cible invalide : mentionnez-la ou fournissez un identifiant.*")] })
  }

  if (action === "add") {
    await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { [field]: id } }, { upsert: true })
  } else {
    await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { [field]: id } }, { upsert: true })
  }
  client.antiraid.invalidateConfig(guildId)

  const label = type === "user" ? "Utilisateur" : type === "role" ? "Rôle" : type === "bot" ? "Bot" : "Salon"
  const mention = type === "role" ? `<@&${id}>` : type === "channel" ? `<#${id}>` : `<@${id}>`
  return message.reply({
    embeds: [
      buildAntiRaidEmbed(
        "✅",
        "Liste blanche mise à jour",
        `> ***Type:** ${label}*\n> ***Cible:** ${mention}*\n> ***Action:** ${action === "add" ? "Ajouté" : "Retiré"}*`
      ),
    ],
  })
}

async function handleAllow(client: Client, message: Message, args: string[], deny: boolean) {
  const guildId = message.guild!.id
  const type = args[0]?.toLowerCase()
  const target = args[1]
  if (!["user", "role", "bot", "channel"].includes(type ?? "")) {
    return message.reply({
      embeds: [buildErrorEmbed("400 Bad Request", `> *Utilisation : \`antiraid ${deny ? "deny" : "allow"} <user|role|bot|channel> <cible>\`.*`)],
    })
  }
  const field =
    type === "user" ? "whitelistedUsers" : type === "role" ? "whitelistedRoles" : type === "bot" ? "whitelistedBots" : "whitelistedChannels"

  let id: string | null = null
  if (type === "user" || type === "bot") id = message.mentions.users.first()?.id ?? target ?? null
  else if (type === "role") id = message.mentions.roles.first()?.id ?? target ?? null
  else id = message.mentions.channels.first()?.id ?? target ?? null

  if (!id) {
    return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cible invalide : mentionnez-la ou fournissez un identifiant.*")] })
  }

  if (deny) {
    await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { [field]: id } }, { upsert: true })
  } else {
    await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { [field]: id } }, { upsert: true })
  }
  client.antiraid.invalidateConfig(guildId)
  const mention = type === "role" ? `<@&${id}>` : type === "channel" ? `<#${id}>` : `<@${id}>`
  return message.reply({
    embeds: [
      buildAntiRaidEmbed(
        "✅",
        deny ? "Whitelist retirée" : "Whitelist rapide",
        `> ***Type:** ${type}*\n> ***Cible:** ${mention}*\n> ***Action:** ${deny ? "Retiré de la liste blanche" : "Ajouté à la liste blanche"}*`
      ),
    ],
  })
}

async function handleHoneypot(client: Client, message: Message, args: string[], config: AntiRaidConfig) {
  const guildId = message.guild!.id
  const action = args[1]?.toLowerCase()
  const target = args[2]?.toLowerCase()

  if (action === "enable" || action === "on") {
    await AntiRaid.findOneAndUpdate({ guildId }, { $set: { "honeypot.enabled": true } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Honeypot activé", "> *Le système piège est maintenant **activé**.*")] })
  }
  if (action === "disable" || action === "off") {
    await AntiRaid.findOneAndUpdate({ guildId }, { $set: { "honeypot.enabled": false } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({ embeds: [buildAntiRaidEmbed("⏹️", "Honeypot désactivé", "> *Le système piège est maintenant **désactivé**.*", colors.yel)] })
  }
  if (action === "add" && target === "channel") {
    const channel = message.mentions.channels.first()
    if (!channel) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un salon : `antiraid honeypot add channel <#salon>`.*")] })
    }
    await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { "honeypot.channels": channel.id } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Salon piège ajouté", `> *<#${channel.id}> est maintenant un **salon piège**.*`)] })
  }
  if (action === "add" && target === "role") {
    const role = message.mentions.roles.first()
    if (!role) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle : `antiraid honeypot add role <@rôle>`.*")] })
    }
    await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { "honeypot.roles": role.id } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Rôle piège ajouté", `> *<@&${role.id}> est maintenant un **rôle piège**.*`)] })
  }
  if (action === "remove" && target === "channel") {
    const channel = message.mentions.channels.first()
    const id = channel?.id ?? args[3]
    if (!id) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un salon : `antiraid honeypot remove channel <#salon>`.*")] })
    }
    await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { "honeypot.channels": id } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Salon piège retiré", "> *Ce salon n'est plus un piège.*", colors.yel)] })
  }
  if (action === "remove" && target === "role") {
    const role = message.mentions.roles.first()
    const id = role?.id ?? args[3]
    if (!id) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle : `antiraid honeypot remove role <@rôle>`.*")] })
    }
    await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { "honeypot.roles": id } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Rôle piège retiré", "> *Ce rôle n'est plus un piège.*", colors.yel)] })
  }
  if (action === "action") {
    const punishment = args[2]?.toLowerCase() as Punishment
    if (!PUNISHMENTS.includes(punishment)) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", `> *Punition inconnue. Punitions disponibles : ${PUNISHMENT_USAGE}.*`)] })
    }
    let duration = config.honeypot.duration
    if (punishment === "timeout" && duration <= 0) duration = 600000
    if (punishment !== "timeout") duration = 0
    await AntiRaid.findOneAndUpdate(
      { guildId },
      { $set: { "honeypot.punishment": punishment, "honeypot.duration": duration } },
      { upsert: true }
    )
    client.antiraid.invalidateConfig(guildId)
    return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Punition honeypot", `> *Les intrus seront sanctionnés : **${PUNISHMENT_LABELS[punishment]}**.*`)] })
  }

  return message.reply({
    embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid honeypot <enable|disable|add channel|remove channel|add role|remove role|action <punition>>`.*")],
  })
}

async function handleLockdown(client: Client, message: Message, args: string[], config: AntiRaidConfig) {
  const guildId = message.guild!.id
  const action = args[0]?.toLowerCase()

  if (action === "on") {
    const duration = args[1] ? parseTime(args[1]) : null
    if (args[1] && duration === null) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemples : `30m`, `1h`, `6h`.*")] })
    }
    await client.antiraid.activateRaidMode(client, config, duration ?? config.raidDuration)
    return message.reply({
      embeds: [buildAntiRaidEmbed("✅", "Mode raid activé", `> *Le serveur est verrouillé pour \`${formatTime(duration ?? config.raidDuration)}\`.*`, colors.orng)],
    })
  }

  if (action === "off") {
    await client.antiraid.deactivateRaidMode(client, config)
    return message.reply({
      embeds: [buildAntiRaidEmbed("✅", "Mode raid désactivé", "> *Le verrouillage du serveur a été levé.*", colors.yel)],
    })
  }

  if (action === "timed") {
    const duration = args[1] ? parseTime(args[1]) : null
    if (duration === null || duration <= 0) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid lockdown timed <durée>` (ex : `2h`).*")] })
    }
    await client.antiraid.activateRaidMode(client, config, duration)
    return message.reply({
      embeds: [buildAntiRaidEmbed("✅", "Lockdown temporisé", `> *Le serveur est verrouillé pour \`${formatTime(duration)}\`.*`, colors.orng)],
    })
  }

  if (action === "auto") {
    await AntiRaid.findOneAndUpdate({ guildId }, { $set: { "lockdown.slowmode": 0, "lockdown.blockJoins": true, "lockdown.blockMessages": true } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({
      embeds: [buildAntiRaidEmbed("✅", "Lockdown auto", "> *Le verrouillage automatique est configuré (déclenché par la détection de raid).*", colors.yel)],
    })
  }

  const active = config.raidMode && Date.now() < config.raidEndsAt
  return message.reply({
    embeds: [
      buildAntiRaidEmbed(
        "🔒",
        "Lockdown",
        active
          ? `> ***État:** Actif (jusqu'à <t:${Math.floor(config.raidEndsAt / 1000)}:T>)*\n> *Utilisez \`lockdown off\` pour lever le verrouillage.*`
          : "> ***État:** Inactif*\n> *Utilisez \`lockdown on [durée]\` pour verrouiller le serveur.*"
      ),
    ],
  })
}

async function handlePanic(client: Client, message: Message, args: string[], config: AntiRaidConfig) {
  const guildId = message.guild!.id
  const action = args[1]?.toLowerCase()

  if (action === "disable" || action === "off") {
    await client.antiraid.deactivatePanic(client, config)
    return message.reply({
      embeds: [buildAntiRaidEmbed("♻️", "Panic désactivé", "> *L'état précédent du serveur a été restauré.*", colors.yel)],
    })
  }

  if (action === "on" || action === undefined) {
    await client.antiraid.activatePanic(client, config)
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "💣",
          "MODE PANIC ACTIF",
          "> *Le serveur est en **urgence critique** : lockdown activé, arrivées bloquées, salons gelés, logs CRITICAL.*",
          colors.red
        ),
      ],
    })
  }

  return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid panic` ou `antiraid panic disable`.*")] })
}

async function handleQuarantine(client: Client, message: Message, args: string[], config: AntiRaidConfig) {
  const guildId = message.guild!.id
  const action = args[1]?.toLowerCase()

  if (action === "add") {
    const user = message.mentions.users.first()
    const id = user?.id ?? args[2]
    if (!id) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un utilisateur : `antiraid quarantine add <@user>`.*")] })
    }
    const result = await client.antiraid.quarantineUser(client, message.guild!, id)
    if (!result) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Impossible de placer cet utilisateur en quarantaine (rôle de quarantaine non configuré ou membre introuvable).*")] })
    }
    return message.reply({
      embeds: [buildAntiRaidEmbed("🛂", "Quarantaine", `> *<@${id}> a été placé en **quarantaine** (rôles retirés, permissions bloquées).*`, colors.orng)],
    })
  }

  if (action === "remove") {
    const user = message.mentions.users.first()
    const id = user?.id ?? args[2]
    if (!id) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un utilisateur : `antiraid quarantine remove <@user>`.*")] })
    }
    await client.antiraid.unquarantineUser(client, message.guild!, id)
    return message.reply({ embeds: [buildAntiRaidEmbed("🛂", "Quarantaine", `> *<@${id}> a été retiré de la quarantaine.*`, colors.yel)] })
  }

  if (action === "list") {
    const users = config.quarantine.users
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "🛂",
          "Quarantaine",
          users.length > 0
            ? `> ***Utilisateurs en quarantaine (${users.length}) :***\n` + users.map((id) => `> <@${id}>`).join("\n")
            : "> *Aucun utilisateur en quarantaine.*",
          colors.yel
        ),
      ],
    })
  }

  if (action === "clear") {
    await AntiRaid.findOneAndUpdate({ guildId }, { $set: { "quarantine.users": [] } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({ embeds: [buildAntiRaidEmbed("🛂", "Quarantaine vidée", "> *Tous les utilisateurs ont été retirés de la quarantaine (rôles conservés).*", colors.yel)] })
  }

  return message.reply({
    embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid quarantine <add|remove|list|clear>`.*")],
  })
}

async function handleLogs(client: Client, message: Message, args: string[], config: AntiRaidConfig) {
  const filter = args[1]?.toLowerCase()
  const events = client.antiraid.getEventLog(message.guild!.id)
  const filtered = filter ? events.filter((e) => e.type === filter) : events
  const slice = filtered.slice(-10)

  const lines =
    slice.length > 0
      ? slice
          .map((e) => `> \`<t:${Math.floor(e.ts / 1000)}:R>\` \`${e.type}\` — ${e.detail ?? "..."}`)
          .join("\n")
      : "> *Aucun événement enregistré.*"

  return message.reply({
    embeds: [
      buildAntiRaidEmbed(
        "🧾",
        `Journal de sécurité${filter ? ` (filtre : \`${filter}\`)` : ""}`,
        lines + `\n\n> ***Total des événements enregistrés :** ${filtered.length}*`,
        colors.yel
      ),
    ],
  })
}

async function handleTest(client: Client, message: Message) {
  await sendLog(
    client,
    message.guild!.id,
    buildAntiRaidEmbed("🧪", "Test anti-raid", "> *Ceci est un message de test. Le système anti-raid fonctionne correctement.*", colors.yel)
  )
  return message.reply({
    embeds: [buildAntiRaidEmbed("✅", "Test envoyé", "> *Un message de test a été envoyé dans le journal configuré.*", colors.yel)],
  })
}

async function handleDebug(client: Client, message: Message) {
  const guildId = message.guild!.id
  const config = await client.antiraid.getConfig(guildId)
  const threat = client.antiraid.getThreatLevel(guildId)
  const suspects = client.antiraid.getTopSuspects(guildId, 5)
  const events = client.antiraid.getEventLog(guildId)
  const last = events.slice(-5)

  const desc =
    `> ***Score de risque:** \`${threat}/100\`*\n` +
    `> ***Membre analysés / suspectés :** ${config.quarantine.users.length} en quarantaine*\n` +
    `> ***Suspects :***\n` +
    (suspects.length > 0 ? suspects.map((s) => `> - <@${s.userId}> → score \`${s.score}\``).join("\n") : "> - *Aucun*") +
    `\n\n### \`🧭\` Dernières décisions\n` +
    (last.length > 0
      ? last
          .map((e) => `> \`${e.type}\` — ${e.detail ?? "..."}`)
          .join("\n")
      : "> *Aucune décision enregistrée.*")

  return message.reply({
    embeds: [buildAntiRaidEmbed("🐞", "Debug anti-raid", desc, colors.yel)],
  })
}

async function handleRestore(client: Client, message: Message, args: string[]) {
  const type = args[1]?.toLowerCase()
  const target = args[2]

  if (!["channel", "role", "permissions"].includes(type ?? "") || !target) {
    return message.reply({
      embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid restore <channel|role|permissions> <id>`.*")],
    })
  }

  if (type === "permissions") {
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "♻️",
          "Restaurer les permissions",
          "> *La restauration des permissions est appliquée automatiquement par le mode lockdown/panic. Utilisez `lockdown off` ou `panic disable` pour restaurer l'état précédent.*",
          colors.yel
        ),
      ],
    })
  }

  if (type === "channel") {
    const result = await client.antiraid.restoreChannel(client, message.guild!, target)
    if (!result) {
      return message.reply({ embeds: [buildErrorEmbed("404 Not Found", "> *Aucun salon supprimé n'a été trouvé pour cet identifiant.*")] })
    }
    return message.reply({
      embeds: [buildAntiRaidEmbed("♻️", "Salon restauré", `> *Le salon a été recréé : <#${result}>.`, colors.yel)],
    })
  }

  const result = await client.antiraid.restoreRole(client, message.guild!, target)
  if (!result) {
    return message.reply({ embeds: [buildErrorEmbed("404 Not Found", "> *Aucun rôle supprimé n'a été trouvé pour cet identifiant.*")] })
  }
  return message.reply({
    embeds: [buildAntiRaidEmbed("♻️", "Rôle restauré", `> *Le rôle **<@&${result}>** a été recréé.`, colors.yel)],
  })
}

async function handleAudit(client: Client, message: Message) {
  const guild = message.guild!
  const dangerousPerms = [
    { perm: "Administrator", label: "Administrateur" },
    { perm: "ManageGuild", label: "Gérer le serveur" },
    { perm: "ManageRoles", label: "Gérer les rôles" },
    { perm: "ManageChannels", label: "Gérer les salons" },
    { perm: "BanMembers", label: "Bannir des membres" },
    { perm: "KickMembers", label: "Expulser des membres" },
    { perm: "ManageWebhooks", label: "Gérer les webhooks" },
  ]

  const adminRoles: string[] = []
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) continue
    if (role.permissions.has("Administrator")) adminRoles.push(`> <@&${role.id}>`)
  }

  const riskyRoles: string[] = []
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) continue
    const has = dangerousPerms.some(({ perm }) => role.permissions.has(perm as never))
    if (has && !role.permissions.has("Administrator")) riskyRoles.push(`> <@&${role.id}> (${dangerousPerms.filter(({ perm }) => role.permissions.has(perm as never)).map(({ label }) => label).join(", ")})`)
  }

  const bots: string[] = []
  for (const member of guild.members.cache.values()) {
    if (!member.user.bot) continue
    const isAdmin = member.permissions.has("Administrator")
    bots.push(`> <@${member.id}>${isAdmin ? " — ⚠️ Admin" : ""}`)
  }

  const config = await client.antiraid.getConfig(guild.id)
  const configIssues: string[] = []
  if (!config.enabled) configIssues.push("> - Le système anti-raid est désactivé.")
  if (!config.modules.nuke.enabled) configIssues.push("> - Le module anti-nuke est désactivé.")
  if (!config.modules.joins.enabled) configIssues.push("> - Le module anti-flood de membres est désactivé.")
  if (config.modules.links.blockDiscordInvites && !config.modules.links.enabled) configIssues.push("> - Le blocage des invitations est configuré mais le module anti-lien est désactivé.")

  const score = Math.max(0, 100 - adminRoles.length * 10 - riskyRoles.length * 5 - (configIssues.length > 0 ? 20 : 0))

  return message.reply({
    embeds: [
      buildAntiRaidEmbed(
        "🔍",
        "Audit de sécurité",
        `> ***Score de sécurité :** \`${score}/100\`*\n\n` +
          `### \`🎭\` Rôles administrateurs (${adminRoles.length})\n` +
          (adminRoles.length > 0 ? adminRoles.slice(0, 10).join("\n") : "> *Aucun*") +
          `\n\n### \`⚠️\` Rôles à permissions dangereuses (${riskyRoles.length})\n` +
          (riskyRoles.length > 0 ? riskyRoles.slice(0, 10).join("\n") : "> *Aucun*") +
          `\n\n### \`🤖\` Bots (${bots.length})\n` +
          (bots.length > 0 ? bots.slice(0, 10).join("\n") : "> *Aucun*") +
          `\n\n### \`🩹\` Failles de configuration\n` +
          (configIssues.length > 0 ? configIssues.join("\n") : "> *Aucune faille détectée.*"),
        colors.yel
      ),
    ],
  })
}

async function handleSimulate(client: Client, message: Message, args: string[], config: AntiRaidConfig) {
  const target = args[1]?.toLowerCase()
  if (target !== "raid" && target !== "nuke") {
    return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid simulate raid|nuke`.*")] })
  }

  if (target === "raid") {
    const joins = config.modules.joins
    const punishment = joins.enabled ? PUNISHMENT_LABELS[joins.punishment] : "Aucune (module désactivé)"
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "🎭",
          "Simulation de raid",
          `> *Simulation : \`20 arrivées rapides\` + \`spam de messages\` + \`mentions massives\`.*\n\n` +
            `### \`📋\` Résultats (aucune action réelle)\n` +
            `> ***Flood de membres :** WOULD ${joins.enabled ? joins.punishment.toUpperCase() : "NOTHING"}*\n` +
            `> ***Spam :** WOULD ${config.modules.spam.enabled ? config.modules.spam.punishment.toUpperCase() : "NOTHING"}*\n` +
            `> ***Mentions :** WOULD ${config.modules.mentions.enabled ? config.modules.mentions.punishment.toUpperCase() : "NOTHING"}*\n` +
            `> ***Mode raid :** ${config.raidMode || joins.punishment === "lockdown" ? "DÉCLENCHEMENT" : "PAS DE DÉCLENCHEMENT"}*\n` +
            `> ***Punition appliquée (anti-flood) :** ${punishment}*`,
          colors.yel
        ),
      ],
    })
  }

  const nuke = config.modules.nuke
  const punishment = nuke.enabled ? PUNISHMENT_LABELS[nuke.punishment] : "Aucune (module désactivé)"
  return message.reply({
    embeds: [
      buildAntiRaidEmbed(
        "💥",
        "Simulation de nuke",
        `> *Simulation : \`suppression de salons\` + \`suppression de rôles\` + \`spam de webhooks\`.*\n\n` +
          `### \`📋\` Résultats (aucune action réelle)\n` +
          `> ***Suppression salons :** WOULD ${nuke.enabled && nuke.channelThreshold >= 1 ? nuke.punishment.toUpperCase() : "NOTHING"}*\n` +
          `> ***Suppression rôles :** WOULD ${nuke.enabled && nuke.roleThreshold >= 1 ? nuke.punishment.toUpperCase() : "NOTHING"}*\n` +
          `> ***Webhooks :** WOULD ${nuke.enabled && nuke.webhookThreshold >= 1 ? nuke.punishment.toUpperCase() : "NOTHING"}*\n` +
          `> ***Mode raid :** ${nuke.enabled && nuke.punishment === "lockdown" ? "DÉCLENCHEMENT" : "PAS DE DÉCLENCHEMENT"}*\n` +
          `> ***Punition appliquée (anti-nuke) :** ${punishment}*`,
        colors.yel
      ),
    ],
  })
}

async function handleProtect(client: Client, message: Message, config: AntiRaidConfig) {
  const guildId = message.guild!.id
  await client.antiraid.applyMode(client, guildId, "high")

  const fresh = await client.antiraid.getConfig(guildId)
  const updates: Record<string, unknown> = {
    enabled: true,
    mode: "high",
  }
  for (const name of MODULES) {
    updates[`modules.${name}.enabled`] = true
  }
  if (fresh.honeypot.channels.length === 0 && message.channel && "id" in message.channel) {
    updates["honeypot.channels"] = [message.channel.id]
  }
  await AntiRaid.findOneAndUpdate({ guildId }, { $set: updates }, { upsert: true })
  client.antiraid.invalidateConfig(guildId)
  await sendLog(
    client,
    guildId,
    buildAntiRaidEmbed("🛡️", "Auto-durcissement", `> ***Par:** <@${message.author.id}>*\n> *Mode **high** appliqué, tous les modules activés, honeypot intelligent.*`, colors.orng)
  )
  return message.reply({
    embeds: [
      buildAntiRaidEmbed(
        "🛡️",
        "Serveur durci",
        "> *Sécurité renforcée : mode **high**, tous les modules activés, honeypot intelligent, seuils resserrés.*",
        colors.orng
      ),
    ],
  })
}

async function handleReport(client: Client, message: Message, config: AntiRaidConfig) {
  const guildId = message.guild!.id
  const threat = client.antiraid.getThreatLevel(guildId)
  const events = client.antiraid.getEventLog(guildId)
  const recent = events.filter((e) => Date.now() - e.ts <= 24 * 60 * 60 * 1000)

  const byType = new Map<string, number>()
  for (const e of recent) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
  const typeLines = [...byType.entries()].map(([type, count]) => `> \`${type}\` → \`${count}\``).join("\n")

  const score = Math.max(0, 100 - threat)

  return message.reply({
    embeds: [
      buildAntiRaidEmbed(
        "📑",
        "Rapport de sécurité",
        `> ***Attaques détectées (24h) :** ${recent.length}*\n` +
          `> ***Score global serveur :** \`${score}/100\`*\n` +
          `> ***Niveau de menace actuel :** \`${threat}/100\`*\n\n` +
          `### \`📈\` Répartition des événements\n` +
          (typeLines || "> *Aucun événement.*") +
          `\n\n### \`⚙️\` Efficacité\n` +
          `> ***Modules actifs :** ${Object.values(config.modules).filter((m) => m.enabled).length}/${MODULES.length}*\n` +
          `> ***Quarantaine :** ${config.quarantine.users.length} utilisateur(s)*\n` +
          `> ***Lockdown :** ${config.raidMode && Date.now() < config.raidEndsAt ? "Actif" : "Inactif"}*`,
        colors.yel
      ),
    ],
  })
}

async function handleReset(client: Client, message: Message) {
  const guildId = message.guild!.id
  const resetModules = {} as AntiRaidConfig["modules"]
  for (const name of MODULES) resetModules[name] = { ...MODULE_DEFAULTS[name] }
  await AntiRaid.findOneAndUpdate(
    { guildId },
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
  client.antiraid.invalidateConfig(guildId)
  client.antiraid.clearEventLog(guildId)
  return message.reply({
    embeds: [buildAntiRaidEmbed("✅", "Configuration réinitialisée", "> *Toute la configuration anti-raid a été réinitialisée aux valeurs par défaut.*", colors.yel)],
  })
}

export { MODULE_DEFAULTS }
