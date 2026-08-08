import type { Client, Message } from "discord.js"
import { EmbedBuilder } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import parseTime from "../../utils/parseTime.js"
import {
  AntiRaid,
  MODULE_DEFAULTS,
  MODULE_LABELS,
  MODULES,
  PREMIUM_MODULES,
  PUNISHMENT_LABELS,
  PUNISHMENTS,
  getConfig,
  type AntiRaidConfig,
  type ModuleName,
  type Punishment,
} from "../../utils/antiraid/schema.js"
import { buildAntiRaidEmbed, sendLog } from "../../utils/antiraid/logs.js"

const HELP_LINES = [
  "`antiraid` — Affiche l'état de la protection.",
  "`antiraid help` — Affiche cette aide.",
  "`antiraid on|off` — Active ou désactive toute la protection.",
  "`antiraid module <module> <on|off>` — Active ou désactive un module.",
  "`antiraid limit <module> <nombre> <durée>` — Fixe le seuil de déclenchement.",
  "`antiraid punish <module> <punition> [durée]` — Fixe la punition du module.",
  "`antiraid verifyrole <@role|off>` — Rôle attribué après vérification (module vérification).",
  "`antiraid log <#salon|off>` — Salon de journalisation.",
  "`antiraid whitelist <add|remove> <@utilisateur|@rôle|id>` — Gère la whitelist.",
  "`antiraid raidmode <on|off> [durée]` — Active ou coupe le verrouillage du serveur.",
  "`antiraid reset` — Réinitialise toute la configuration.",
  "`antiraid test` — Envoie un test dans le journal.",
]

const PUNISHMENT_USAGE = PUNISHMENTS.map((p) => `\`${p}\``).join(", ")

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

function buildOverviewEmbed(client: Client, message: Message, config: AntiRaidConfig): EmbedBuilder {
  const status = config.enabled ? "✅ **Activé**" : "❌ **Désactivé**"
  const raidActive = config.raidMode && Date.now() < config.raidEndsAt
  const raid = raidActive
    ? `🔒 **Actif** (jusqu'à <t:${Math.floor(config.raidEndsAt / 1000)}:T>)`
    : "⭕ **Inactif**"
  const log = config.logChannel ? `<#${config.logChannel}>` : "`Aucun`"
  const premium = config.premium ? "✅ **Premium**" : "❌ **Standard**"
  const premiumNotice = config.premium
    ? ""
    : "\n> *🔒 = module premium — activez le premium pour l'utiliser.*"

  const moduleLines = MODULES.map((name) => buildModuleLine(config, name)).join("\n")

  return new EmbedBuilder()
    .setTitle(" ")
    .setDescription(
      `# \`🛡️\` 〃 Anti-Raid\n` +
        `> *Protection anti-raid configurable par serveur.*\n\n` +
        `### \`📊\` Statut\n` +
        `> ***Anti-Raid:** ${status}*\n` +
        `> ***Mode raid:** ${raid}*\n` +
        `> ***Journal:** ${log}*\n` +
        `> ***Compte:** ${premium}*\n\n` +
        `### \`🧩\` Modules\n` +
        moduleLines +
        `${premiumNotice}\n\n` +
        `### \`👥\` Whitelist\n` +
        `> ***Utilisateurs:** ${config.whitelistedUsers.length}*\n` +
        `> ***Rôles:** ${config.whitelistedRoles.length}*`
    )
    .setFooter({ text: message.author.tag, iconURL: message.author.displayAvatarURL() })
}

async function getOrCreateConfig(guildId: string): Promise<AntiRaidConfig> {
  return getConfig(guildId)
}

function resolveModuleName(raw: string): ModuleName | null {
  const name = raw.toLowerCase() as ModuleName
  return MODULES.includes(name) ? name : null
}

export default {
  name: "antiraid",
  description: "Configure la protection anti-raid du serveur.",
  category: "antiraid",
  aliases: ["anti-raid", "protection", "ar"],
  permissions: ["Administrator"],
  usage: "[sous-commande]",
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command ${client.prefix}antiraid used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const config = await getOrCreateConfig(message.guild.id)
    const sub = args[0]?.toLowerCase()

    if (!sub || sub === "status") {
      return message.reply({ embeds: [buildOverviewEmbed(client, message, config)] })
    }

    switch (sub) {
      case "help":
        return message.reply({
          embeds: [
            buildAntiRaidEmbed("❓", "Aide anti-raid", HELP_LINES.map((line) => `> ${line}`).join("\n"), colors.yel),
          ],
        })

      case "on":
      case "enable": {
        await AntiRaid.findOneAndUpdate({ guildId: message.guild.id }, { $set: { enabled: true } }, { upsert: true })
        client.antiraid.invalidateConfig(message.guild.id)
        return message.reply({
          embeds: [buildAntiRaidEmbed("✅", "Anti-Raid activé", "> *La protection anti-raid est maintenant **activée** sur ce serveur.*")],
        })
      }

      case "off":
      case "disable": {
        await AntiRaid.findOneAndUpdate({ guildId: message.guild.id }, { $set: { enabled: false } }, { upsert: true })
        client.antiraid.invalidateConfig(message.guild.id)
        return message.reply({
          embeds: [buildAntiRaidEmbed("✅", "Anti-Raid désactivé", "> *La protection anti-raid est maintenant **désactivée** sur ce serveur.*", colors.yel)],
        })
      }

      case "module": {
        const name = resolveModuleName(args[1] ?? "")
        const value = args[2]?.toLowerCase()
        if (!name) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", `> *Module inconnu. Modules disponibles : \`${MODULES.join("`, `")}\`.*`)],
          })
        }
        if (value !== "on" && value !== "off") {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid module <module> <on|off>`.*")],
          })
        }
        const enabled = value === "on"
        if (enabled && PREMIUM_MODULES.includes(name) && !config.premium) {
          return message.reply({
            embeds: [buildErrorEmbed("403 Forbidden", `> *Le module \`${name}\` (${MODULE_LABELS[name]}) est réservé aux serveurs **premium**.🔒*`)],
          })
        }
        await AntiRaid.findOneAndUpdate(
          { guildId: message.guild.id },
          { $set: { [`modules.${name}.enabled`]: enabled } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(message.guild.id)
        return message.reply({
          embeds: [
            buildAntiRaidEmbed(
              "✅",
              "Module mis à jour",
              `> ***Module:** ${MODULE_LABELS[name]} (\`${name}\`)*\n> ***État:** ${enabled ? "Activé" : "Désactivé"}*`
            ),
          ],
        })
      }

      case "limit": {
        const name = resolveModuleName(args[1] ?? "")
        const count = Number(args[2])
        const interval = parseTime(args[3] ?? "")
        if (!name) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", `> *Module inconnu. Modules disponibles : \`${MODULES.join("`, `")}\`.*`)],
          })
        }
        if (!Number.isInteger(count) || count < 1) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Le nombre d'actions doit être un entier supérieur ou égal à 1.*")],
          })
        }
        if (interval === null || interval <= 0) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemples : `5s`, `10m`, `1h`, `2d`.*")],
          })
        }
        await AntiRaid.findOneAndUpdate(
          { guildId: message.guild.id },
          { $set: { [`modules.${name}.limit`]: count, [`modules.${name}.interval`]: interval } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(message.guild.id)
        return message.reply({
          embeds: [
            buildAntiRaidEmbed(
              "✅",
              "Seuil mis à jour",
              `> ***Module:** ${MODULE_LABELS[name]} (\`${name}\`)*\n> ***Seuil:** \`${count}\` actions en \`${formatTime(interval)}\`*`
            ),
          ],
        })
      }

      case "punish": {
        const name = resolveModuleName(args[1] ?? "")
        const punishment = args[2]?.toLowerCase() as Punishment
        if (!name) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", `> *Module inconnu. Modules disponibles : \`${MODULES.join("`, `")}\`.*`)],
          })
        }
        if (!PUNISHMENTS.includes(punishment)) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", `> *Punition inconnue. Punitions disponibles : ${PUNISHMENT_USAGE}.*`)],
          })
        }
        const current = config.modules[name]
        let duration = current.duration
        if (punishment === "timeout" || punishment === "lockdown") {
          const parsed = args[3] ? parseTime(args[3]) : null
          if (args[3] && parsed === null) {
            return message.reply({
              embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemples : `10m`, `1h`.*")],
            })
          }
          if (parsed !== null) duration = parsed
          else if (duration <= 0) duration = 600000
        } else {
          duration = 0
        }
        await AntiRaid.findOneAndUpdate(
          { guildId: message.guild.id },
          {
            $set: {
              [`modules.${name}.punishment`]: punishment,
              [`modules.${name}.duration`]: duration,
            },
          },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(message.guild.id)
        const durationText =
          duration > 0 && (punishment === "timeout" || punishment === "lockdown")
            ? ` (durée : \`${formatTime(duration)}\`)`
            : ""
        return message.reply({
          embeds: [
            buildAntiRaidEmbed(
              "✅",
              "Punition mise à jour",
              `> ***Module:** ${MODULE_LABELS[name]} (\`${name}\`)*\n> ***Punition:** **${PUNISHMENT_LABELS[punishment]}**${durationText}*`
            ),
          ],
        })
      }

      case "verifyrole": {
        const role = message.mentions.roles.first()
        const raw = args[1]?.toLowerCase()
        const roleId = role ? role.id : raw && raw !== "off" && raw !== "none" ? (args[1] as string) : null
        if (!roleId && raw !== "off" && raw !== "none") {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle ou utilisez `antiraid verifyrole off`.*")],
          })
        }
        await AntiRaid.findOneAndUpdate(
          { guildId: message.guild.id },
          { $set: { "modules.verify.role": roleId } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(message.guild.id)
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
        await AntiRaid.findOneAndUpdate(
          { guildId: message.guild.id },
          { $set: { logChannel: channelId } },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(message.guild.id)
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

      case "whitelist": {
        const action = args[1]?.toLowerCase()
        if (action !== "add" && action !== "remove") {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antiraid whitelist <add|remove> <@utilisateur|@rôle|id>`.*")],
          })
        }
        const user = message.mentions.users.first()
        const role = message.mentions.roles.first()
        const rawId = args[2]
        if (!user && !role && !rawId) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un utilisateur, un rôle ou fournissez un identifiant.*")],
          })
        }
        const targetId = user?.id ?? role?.id ?? rawId
        const isRole = Boolean(role)

        if (action === "add") {
          const field = isRole ? "whitelistedRoles" : "whitelistedUsers"
          await AntiRaid.findOneAndUpdate(
            { guildId: message.guild.id },
            { $addToSet: { [field]: targetId } },
            { upsert: true }
          )
        } else {
          await AntiRaid.findOneAndUpdate(
            { guildId: message.guild.id },
            {
              $pull: {
                whitelistedUsers: targetId,
                whitelistedRoles: targetId,
              },
            },
            { upsert: true }
          )
        }
        client.antiraid.invalidateConfig(message.guild.id)
        return message.reply({
          embeds: [
            buildAntiRaidEmbed(
              "✅",
              "Whitelist mise à jour",
              `> ***Action:** ${action === "add" ? "Ajout" : "Retrait"}*\n> ***Type:** ${isRole ? "Rôle" : "Utilisateur"}*\n> ***Cible:** ${isRole ? `<@&${targetId}>` : `<@${targetId}>`}*`
            ),
          ],
        })
      }

      case "raidmode": {
        const action = args[1]?.toLowerCase()
        if (action === "on") {
          const duration = args[2] ? parseTime(args[2]) : null
          if (args[2] && duration === null) {
            return message.reply({
              embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemples : `30m`, `1h`, `6h`.*")],
            })
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
        const active = config.raidMode && Date.now() < config.raidEndsAt
        return message.reply({
          embeds: [
            buildAntiRaidEmbed(
              "🔒",
              "Mode raid",
              active
                ? `> ***État:** Actif (jusqu'à <t:${Math.floor(config.raidEndsAt / 1000)}:T>)*`
                : "> ***État:** Inactif*"
            ),
          ],
        })
      }

      case "reset": {
        await AntiRaid.findOneAndUpdate(
          { guildId: message.guild.id },
          {
            $set: {
              enabled: false,
              raidMode: false,
              raidEndsAt: 0,
              raidDuration: MODULE_DEFAULTS.nuke.duration,
              logChannel: null,
              whitelistedUsers: [],
              whitelistedRoles: [],
              modules: {
                spam: { ...MODULE_DEFAULTS.spam },
                mentions: { ...MODULE_DEFAULTS.mentions },
                links: { ...MODULE_DEFAULTS.links },
                emojis: { ...MODULE_DEFAULTS.emojis },
                joins: { ...MODULE_DEFAULTS.joins },
                bots: { ...MODULE_DEFAULTS.bots },
                nuke: { ...MODULE_DEFAULTS.nuke },
                selfbots: { ...MODULE_DEFAULTS.selfbots },
                alts: { ...MODULE_DEFAULTS.alts },
                verify: { ...MODULE_DEFAULTS.verify },
              },
            },
          },
          { upsert: true }
        )
        client.antiraid.invalidateConfig(message.guild.id)
        return message.reply({
          embeds: [buildAntiRaidEmbed("✅", "Configuration réinitialisée", "> *Toute la configuration anti-raid a été réinitialisée aux valeurs par défaut.*", colors.yel)],
        })
      }

      case "test": {
        await sendLog(
          client,
          message.guild.id,
          buildAntiRaidEmbed("🧪", "Test anti-raid", "> *Ceci est un message de test. Le système anti-raid fonctionne correctement.*", colors.yel)
        )
        return message.reply({
          embeds: [buildAntiRaidEmbed("✅", "Test envoyé", "> *Un message de test a été envoyé dans le journal configuré.*", colors.yel)],
        })
      }

      default:
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", `> *Sous-commande inconnue : \`${sub}\`. Utilisez \`antiraid help\`.*`)],
        })
    }
  },
}
