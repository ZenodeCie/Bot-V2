import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { extractReason, logCommandUse, replyError, requireGuild, resolveChannelIdFromArg } from "../../utils/moderation/helpers.js"
import { buildNavRow, handlePageNav, type PageRenderResult } from "../../utils/moderation/pagination.js"
import { appEmojiHeading, appEmojiText } from "../../utils/appEmojis.js"
import { buildPartnershipEmbed } from "../../utils/partnership/logs.js"
import { checkCooldown, handlePartnershipButton, postReviewRequest } from "../../utils/partnership/engine.js"
import formatTime from "../../utils/formatTime.js"
import parseTime from "../../utils/parseTime.js"
import {
  PartnershipConfig,
  PartnershipRequest,
  countPartners,
  findPendingRequest,
  formatRequestId,
  getConfig,
  isActivePartner,
  listPartners,
  nextRequestId,
  removePartner,
} from "../../utils/partnership/schema.js"

const INVITE_RE = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)?([\w-]{2,32})$/i

function extractInviteCode(raw: string): string | null {
  const trimmed = raw.trim()
  const match = INVITE_RE.exec(trimmed)
  return match ? match[1] : null
}

function resolveRoleIdFromArg(arg: string): string | null {
  const trimmed = arg.trim()
  const mention = /^<@&(\d{17,20})>$/.exec(trimmed)
  if (mention) return mention[1]
  if (/^\d{17,20}$/.test(trimmed)) return trimmed
  return null
}

async function hasManageGuild(message: Message): Promise<boolean> {
  return !!message.member?.permissions.has("ManageGuild")
}

async function renderPartnersPage(guildId: string, _target: string, page: number): Promise<PageRenderResult> {
  const PER_PAGE = 8
  const total = await countPartners(guildId)
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const safe = Math.min(page, totalPages - 1)
  const partners = await listPartners(guildId, safe * PER_PAGE, PER_PAGE)

  const lines = partners.map(
    (p) =>
      `> **${p.targetGuildName}** (\`${p.targetGuildId}\`)\n` +
      `> *discord.gg/${p.inviteCode} — ajouté par ${p.requesterUsername}*`
  )

  const embed = {
    title: " ",
    description:
      `${appEmojiHeading("people", "Partenaires actifs")}\n` +
      `> ***Total :** ${total}*\n\n` +
      (lines.join("\n\n") || "> *Aucun partenariat actif.*") +
      `\n\n> ***Page :** ${safe + 1}/${totalPages}*`,
    color: 0x5865f2,
  }

  return { embeds: [embed], totalPages }
}

export default {
  name: "partenariat",
  description: "Système de partenariats : demande, validation par le staff, annonce et suivi.",
  category: "partenariat",
  aliases: ["partner", "partnership"],
  permissions: [],
  usage: "<demander|liste|retirer|config> ...",
  slash: [
    {
      name: "action",
      description: "Action",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: "demander", value: "demander" },
        { name: "liste", value: "liste" },
        { name: "retirer", value: "retirer" },
        { name: "config", value: "config" },
      ],
    },
    { name: "invitation", description: "Lien ou code d'invitation (demander)", type: ApplicationCommandOptionType.String, required: false },
    { name: "description", description: "Description du serveur (demander)", type: ApplicationCommandOptionType.String, required: false },
    { name: "id_serveur", description: "ID du serveur partenaire (retirer)", type: ApplicationCommandOptionType.String, required: false },
    {
      name: "cle",
      description: "Réglage à modifier (config)",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "enabled", value: "enabled" },
        { name: "reviewchannel", value: "reviewchannel" },
        { name: "announcechannel", value: "announcechannel" },
        { name: "role", value: "role" },
        { name: "cooldown", value: "cooldown" },
        { name: "minmembers", value: "minmembers" },
      ],
    },
    { name: "valeur", description: "Valeur (config)", type: ApplicationCommandOptionType.String, required: false },
    { name: "page", description: "Page (liste)", type: ApplicationCommandOptionType.Integer, required: false, minValue: 1 },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action", true)
    if (action === "demander") {
      const invitation = i.options.getString("invitation") ?? ""
      const description = i.options.getString("description") ?? ""
      return [action, invitation, description]
    }
    if (action === "retirer") return [action, i.options.getString("id_serveur") ?? ""]
    if (action === "liste") {
      const page = i.options.getInteger("page")
      return [action, ...(page ? [String(page)] : [])]
    }
    if (action === "config") {
      const key = i.options.getString("cle")
      const value = i.options.getString("valeur")
      return [action, ...(key ? [key] : []), ...(value ? [value] : [])]
    }
    return [action]
  },

  async execute(client: Client, message: Message, args: string[]) {
    logCommandUse("partenariat", message)
    const guild = requireGuild(message)
    if (!guild) return

    const action = args[0]?.toLowerCase()

    // ---------------------------------------------------------------
    // demander — ouvert à tout le monde
    // ---------------------------------------------------------------
    if (action === "demander" || action === "demande") {
      const config = await getConfig(guild.id)
      if (!config.enabled || !config.reviewChannel) {
        return replyError(message, "503 Service Unavailable", "> *Le système de partenariat n'est pas configuré sur ce serveur.*")
      }

      const inviteArg = args[1]
      const description = extractReason(args, 2)
      if (!inviteArg) {
        return replyError(message, "400 Bad Request", "> *Utilisation : `partenariat demander <invitation> <description>`.*")
      }

      const code = extractInviteCode(inviteArg)
      if (!code) {
        return replyError(message, "400 Bad Request", "> *Lien d'invitation invalide.*")
      }

      const cooldown = await checkCooldown(guild.id, message.author.id)
      if (!cooldown.ok) {
        return replyError(
          message,
          "429 Too Many Requests",
          `> *Vous devez attendre encore ${formatTime(cooldown.remaining)} avant une nouvelle demande.*`
        )
      }

      let invite
      try {
        invite = await client.fetchInvite(code)
      } catch {
        return replyError(message, "404 Not Found", "> *Invitation introuvable ou expirée.*")
      }

      const targetGuild = invite.guild
      if (!targetGuild) {
        return replyError(message, "400 Bad Request", "> *Cette invitation ne mène pas à un serveur valide.*")
      }
      if (targetGuild.id === guild.id) {
        return replyError(message, "400 Bad Request", "> *Impossible de vous partenariser avec vous-même.*")
      }

      const memberCount = invite.memberCount ?? 0
      if (config.minMembers > 0 && memberCount < config.minMembers) {
        return replyError(
          message,
          "403 Forbidden",
          `> *Ce serveur ne remplit pas le seuil minimum de membres requis (\`${config.minMembers}\`).*`
        )
      }

      if (await isActivePartner(guild.id, targetGuild.id)) {
        return replyError(message, "409 Conflict", "> *Ce serveur est déjà partenaire.*")
      }
      if (await findPendingRequest(guild.id, targetGuild.id)) {
        return replyError(message, "409 Conflict", "> *Une demande est déjà en attente pour ce serveur.*")
      }

      const requestId = await nextRequestId(guild.id)
      const request = await PartnershipRequest.create({
        requestId,
        requestIdFormatted: formatRequestId(requestId),
        guildId: guild.id,
        requesterId: message.author.id,
        requesterUsername: message.author.username,
        inviteCode: code,
        targetGuildId: targetGuild.id,
        targetGuildName: targetGuild.name,
        targetMemberCount: memberCount,
        description: description || "Aucune description fournie",
        status: "PENDING",
        createdAt: Date.now(),
      })

      await postReviewRequest(client, guild, request.toObject())

      return message.reply({
        embeds: [
          buildPartnershipEmbed(
            "check",
            "Demande envoyée",
            `> ***Serveur :** ${targetGuild.name}*\n> ***Référence :** ${request.requestIdFormatted}*\n> *Le staff va examiner votre demande.*`
          ),
        ],
      })
    }

    // ---------------------------------------------------------------
    // liste — ouvert à tout le monde
    // ---------------------------------------------------------------
    if (action === "liste" || action === "list" || !action) {
      const page = Math.max(0, (Number(args[1]) || 1) - 1)
      const { embeds, totalPages } = await renderPartnersPage(guild.id, guild.id, page)
      return message.reply({
        embeds,
        components: [buildNavRow("partenariat", guild.id, message.author.id, guild.id, page, totalPages)],
      })
    }

    // ---------------------------------------------------------------
    // retirer — staff uniquement
    // ---------------------------------------------------------------
    if (action === "retirer" || action === "remove") {
      if (!(await hasManageGuild(message))) {
        return replyError(message, "401 Unauthorized", "> *Cette action nécessite la permission **Gérer le serveur**.*")
      }
      const targetId = args[1]
      if (!targetId) {
        return replyError(message, "400 Bad Request", "> *Utilisation : `partenariat retirer <id_serveur>`.*")
      }
      const removed = await removePartner(guild.id, targetId)
      if (!removed) {
        return replyError(message, "404 Not Found", "> *Aucun partenariat actif trouvé pour cet identifiant.*")
      }
      return message.reply({
        embeds: [buildPartnershipEmbed("cancel", "Partenariat terminé", `> ***Serveur :** \`${targetId}\`*`)],
      })
    }

    // ---------------------------------------------------------------
    // config — staff uniquement
    // ---------------------------------------------------------------
    if (action === "config") {
      if (!(await hasManageGuild(message))) {
        return replyError(message, "401 Unauthorized", "> *Cette action nécessite la permission **Gérer le serveur**.*")
      }
      const key = args[1]?.toLowerCase()
      const value = args[2]

      if (!key) {
        const config = await getConfig(guild.id)
        return message.reply({
          embeds: [
            buildPartnershipEmbed(
              "cog",
              "Configuration du partenariat",
              `> ***Activé :** ${config.enabled ? "Oui" : "Non"}*\n` +
                `> ***Salon de validation :** ${config.reviewChannel ? `<#${config.reviewChannel}>` : "Aucun"}*\n` +
                `> ***Salon d'annonce :** ${config.announceChannel ? `<#${config.announceChannel}>` : "Aucun"}*\n` +
                `> ***Rôle partenaire :** ${config.partnerRole ? `<@&${config.partnerRole}>` : "Aucun"}*\n` +
                `> ***Cooldown :** ${config.cooldown > 0 ? formatTime(config.cooldown) : "—"}*\n` +
                `> ***Membres min. requis :** ${config.minMembers > 0 ? config.minMembers : "—"}*`,
              null
            ),
          ],
        })
      }

      if (key === "enabled") {
        const enabled = value?.toLowerCase() === "on" || value?.toLowerCase() === "true"
        await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { enabled }, { upsert: true })
        return message.reply({
          embeds: [buildPartnershipEmbed("check", "Configuration mise à jour", `> ***Activé :** ${enabled ? "Oui" : "Non"}*`)],
        })
      }

      if (key === "reviewchannel" || key === "announcechannel") {
        const channelId = value === "none" ? null : resolveChannelIdFromArg(value ?? "")
        if (value !== "none" && !channelId) {
          return replyError(message, "400 Bad Request", "> *Salon invalide. Mentionnez un salon ou `none` pour désactiver.*")
        }
        const field = key === "reviewchannel" ? "reviewChannel" : "announceChannel"
        await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { [field]: channelId }, { upsert: true })
        return message.reply({
          embeds: [
            buildPartnershipEmbed(
              "check",
              "Configuration mise à jour",
              `> ***${key === "reviewchannel" ? "Salon de validation" : "Salon d'annonce"} :** ${channelId ? `<#${channelId}>` : "Aucun"}*`
            ),
          ],
        })
      }

      if (key === "role") {
        const roleId = value === "none" ? null : resolveRoleIdFromArg(value ?? "")
        if (value !== "none" && !roleId) {
          return replyError(message, "400 Bad Request", "> *Rôle invalide. Mentionnez un rôle ou `none` pour désactiver.*")
        }
        await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { partnerRole: roleId }, { upsert: true })
        return message.reply({
          embeds: [buildPartnershipEmbed("check", "Configuration mise à jour", `> ***Rôle partenaire :** ${roleId ? `<@&${roleId}>` : "Aucun"}*`)],
        })
      }

      if (key === "cooldown") {
        const ms = value === "none" || value === "0" ? 0 : value ? parseTime(value) : null
        if (ms === null) return replyError(message, "400 Bad Request", "> *Durée invalide. Exemple : `24h`, `none`.*")
        await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { cooldown: ms }, { upsert: true })
        return message.reply({
          embeds: [buildPartnershipEmbed("check", "Configuration mise à jour", `> ***Cooldown :** ${ms > 0 ? formatTime(ms) : "—"}*`)],
        })
      }

      if (key === "minmembers") {
        const min = Number(value)
        if (!Number.isFinite(min) || min < 0) {
          return replyError(message, "400 Bad Request", "> *Valeur invalide. Exemple : `50`.*")
        }
        await PartnershipConfig.findOneAndUpdate({ guildId: guild.id }, { minMembers: Math.floor(min) }, { upsert: true })
        return message.reply({
          embeds: [buildPartnershipEmbed("check", "Configuration mise à jour", `> ***Membres min. requis :** ${Math.floor(min) || "—"}*`)],
        })
      }

      return replyError(
        message,
        "400 Bad Request",
        "> *Clé invalide. Options : `enabled`, `reviewchannel`, `announcechannel`, `role`, `cooldown`, `minmembers`.*"
      )
    }

    return replyError(
      message,
      "400 Bad Request",
      "> *Utilisation : `partenariat <demander|liste|retirer|config> ...`*"
    )
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    const handledButton = await handlePartnershipButton(client, interaction)
    if (handledButton) return true
    return handlePageNav(interaction, "partenariat", renderPartnersPage)
  },
}
