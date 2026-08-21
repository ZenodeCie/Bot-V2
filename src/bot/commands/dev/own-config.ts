import type { Client, Interaction, Message } from "discord.js"
import {
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
} from "discord.js"
import config from "../../config.js"
import { appEmojiComponent, appEmojiText } from "../../utils/appEmojis.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import {
  getPremiumConfig,
  resetPremiumConfig,
  setBoosterRole,
  setPremiumServer,
  type PremiumConfigDoc,
} from "../../utils/premium.js"

const COMPONENTS_V2_FLAGS = MessageFlags.IsComponentsV2
const CONTAINER_ACCENT = 0x36373e
const RESET_VALUE = "__reset__"

function roleToId(arg: string): string | null {
  const trimmed = arg.trim()
  const mention = /^<@&(\d{17,20})>$/.exec(trimmed)
  if (mention) return mention[1]
  if (/^\d{17,20}$/.test(trimmed)) return trimmed
  return null
}

function replyError(message: Message, title: string, desc: string) {
  return message.reply({ embeds: [buildErrorEmbed(title, desc)] })
}

function statusText(cfg: PremiumConfigDoc, guild: { id: string } | null, role: { id: string } | null): string {
  if (guild && role) return `${appEmojiText("check")} Actif`
  if (!cfg.premiumServerId) return `${appEmojiText("cancel")} Inactif — aucun serveur premium défini`
  if (!guild) return `${appEmojiText("cancel")} Inactif — serveur premium introuvable (le bot n'y est plus ?)`
  if (!cfg.boosterRoleId) return `${appEmojiText("cancel")} Inactif — aucun rôle boosteur défini`
  return `${appEmojiText("cancel")} Inactif — rôle boosteur introuvable`
}

export function buildPremiumContainer(client: Client, cfg: PremiumConfigDoc): ContainerBuilder[] {
  const guild = cfg.premiumServerId ? (client.guilds.cache.get(cfg.premiumServerId) ?? null) : null
  const role = guild && cfg.boosterRoleId ? (guild.roles.cache.get(cfg.boosterRoleId) ?? null) : null

  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(`# ${appEmojiText("cog")} 〃 Configuration premium`))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Les membres **premium** sont les personnes possédant le rôle boosteur sur le serveur premium.*\n\n` +
        `> ${appEmojiText("pin")} ***Serveur premium :** ${guild ? `${guild.name} (\`${guild.id}\`)` : "*Aucun*"}*\n` +
        `> ${appEmojiText("people")} ***Rôle boosteur :** ${role ? `${role.name} ${role}` : "*Aucun*"}*\n` +
        `> ***Statut :** ${statusText(cfg, guild, role)}*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("pin")} **Choisir le serveur premium**`))
  const guildOptions = [...client.guilds.cache.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25)
    .map((g) => ({ label: g.name, description: g.id, value: g.id, default: g.id === cfg.premiumServerId }))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new StringSelectMenuBuilder()
        .setCustomId("oc_server_sel")
        .setPlaceholder("Choisir le serveur premium...")
        .addOptions([
          ...guildOptions,
          { label: "Aucun serveur (réinitialiser)", value: RESET_VALUE, default: !cfg.premiumServerId },
        ])
    )
  )
  if (client.guilds.cache.size > 25) {
    container.addTextDisplayComponents((t) =>
      t.setContent(`> *Seuls les 25 premiers serveurs sont listés — utilisez \`${config.prefix}oc server <id>\` pour les autres.*`)
    )
  }
  container.addSeparatorComponents((s) => s.setDivider(true))

  container.addTextDisplayComponents((t) => t.setContent(`${appEmojiText("people")} **Rôle boosteur**`))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) =>
        t.setContent(
          `**Définir le rôle boosteur**\n> ${
            role
              ? `${role.name} ${role}`
              : cfg.boosterRoleId && guild
                ? "Rôle introuvable"
                : !cfg.premiumServerId
                  ? "Aucun rôle défini — choisissez d'abord un serveur premium"
                  : "Aucun rôle défini"
          }`
        )
      )
      .setButtonAccessory((btn) =>
        btn
          .setCustomId("oc_role_btn")
          .setEmoji(appEmojiComponent("cog"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!cfg.premiumServerId)
      )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addSectionComponents((sectionBuilder) =>
    sectionBuilder
      .addTextDisplayComponents((t) => t.setContent("**Réinitialiser toute la configuration**"))
      .setButtonAccessory((btn) => btn.setCustomId("oc_reset_btn").setEmoji(appEmojiComponent("loop")).setStyle(ButtonStyle.Danger))
  )

  return [container]
}

const panelRefs = new Map<string, { channelId: string; messageId: string }>()

async function handlePanelInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return false
  const customId = interaction.customId
  if (!customId.startsWith("oc_")) return false

  if (!config.ownerId.includes(interaction.user.id)) {
    if (interaction.isRepliable()) {
      await interaction
        .reply({ content: "> *Cette commande est réservée au propriétaire du bot.*", flags: MessageFlags.Ephemeral })
        .catch(() => undefined)
    }
    return true
  }

  const refresh = async (): Promise<boolean> => {
    try {
      const cfg = await getPremiumConfig()
      const containers = buildPremiumContainer(client, cfg)
      if (interaction.isModalSubmit()) {
        const ref = panelRefs.get(interaction.user.id)
        if (ref) {
          const channel = client.channels.cache.get(ref.channelId)
          if (channel && channel.isTextBased()) {
            const message = await channel.messages.fetch(ref.messageId).catch(() => null)
            if (message) {
              await message.edit({ components: containers, flags: COMPONENTS_V2_FLAGS })
              return true
            }
          }
        }
        return false
      }
      await interaction.update({ components: containers, flags: COMPONENTS_V2_FLAGS })
      return true
    } catch (error) {
      console.error("Failed to refresh own-config panel:", error)
      return false
    }
  }

  if (interaction.isStringSelectMenu() && customId === "oc_server_sel") {
    const value = interaction.values[0]
    if (value === RESET_VALUE) {
      await resetPremiumConfig()
      console.log(`Premium config reset by ${interaction.user.id}`)
    } else {
      const guild = client.guilds.cache.get(value)
      if (!guild) {
        await interaction.reply({ content: "> *Serveur introuvable.*", flags: MessageFlags.Ephemeral })
        return true
      }
      await setPremiumServer(guild.id)
      console.log(`Premium server set to ${guild.name} (${guild.id}) by ${interaction.user.id}`)
    }
    return refresh()
  }

  if (interaction.isButton() && customId === "oc_role_btn") {
    const cfg = await getPremiumConfig()
    if (!cfg.premiumServerId) {
      await interaction.reply({ content: "> *Aucun serveur premium défini.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const premiumGuild = client.guilds.cache.get(cfg.premiumServerId)
    const roles = premiumGuild ? await premiumGuild.roles.fetch().catch(() => null) : null
    if (!premiumGuild || !roles) {
      await interaction.reply({
        content: "> *Serveur premium introuvable (le bot n'y est plus ?).*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    const roleList = [...roles.values()]
      .filter((r) => r.id !== premiumGuild.id)
      .sort((a, b) => b.position - a.position)
      .slice(0, 25)
    const totalRoles = roles.size - 1

    const roleSelect = new StringSelectMenuBuilder()
      .setCustomId("role_select")
      .setPlaceholder("Choisir le rôle boosteur...")
      .setMinValues(1)
      .setMaxValues(1)
      .setRequired(true)
      .addOptions(
        roleList.map((r) => ({
          label: r.name,
          value: r.id,
          default: r.id === cfg.boosterRoleId,
        }))
      )

    const roleLabel = new LabelBuilder()
      .setLabel("Rôle boosteur")
      .setDescription(
        roleList.length > 0
          ? `Sélectionnez le rôle boosteur (${premiumGuild.name})${
              totalRoles > 25 ? ` — ${totalRoles} rôles, 25 affichés` : ""
            }`
          : "Aucun rôle disponible"
      )
      .setStringSelectMenuComponent(roleSelect)

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId("oc_role_modal")
        .setTitle("Rôle boosteur")
        .addLabelComponents(roleLabel)
    )
    return true
  }

  if (interaction.isButton() && customId === "oc_reset_btn") {
    await resetPremiumConfig()
    console.log(`Premium config reset by ${interaction.user.id}`)
    return refresh()
  }

  if (interaction.isModalSubmit() && customId === "oc_role_modal") {
    const values = interaction.fields.getStringSelectValues("role_select")
    const roleId = values[0]
    if (!roleId) {
      await interaction.reply({ content: "> *Aucun rôle sélectionné.*", flags: MessageFlags.Ephemeral })
      return true
    }
    const cfg = await getPremiumConfig()
    if (!cfg.premiumServerId) {
      await interaction.reply({
        content: "> *Aucun serveur premium défini — choisissez d'abord un serveur dans le panneau.*",
        flags: MessageFlags.Ephemeral,
      })
      return true
    }
    const premiumGuild = client.guilds.cache.get(cfg.premiumServerId)
    const role =
      premiumGuild?.roles.cache.get(roleId) ?? (premiumGuild ? await premiumGuild.roles.fetch(roleId).catch(() => null) : null)
    if (!role) {
      await interaction.reply({ content: "> *Ce rôle est introuvable sur le serveur premium.*", flags: MessageFlags.Ephemeral })
      return true
    }
    await setBoosterRole(role.id)
    console.log(`Booster role set to ${role.name} (${role.id}) on ${premiumGuild?.name} by ${interaction.user.id}`)
    const updated = await refresh()
    await interaction.reply({
      content:
        updated
          ? `> *Rôle boosteur mis à jour : **${role.name}**.*`
          : `> *Rôle boosteur mis à jour : **${role.name}**. Panneau introuvable, rouvrez \`${config.prefix}oc\`.*`,
      flags: MessageFlags.Ephemeral,
    })
    return true
  }

  return true
}

export default {
  name: "own-config",
  description: "Panneau de configuration premium : serveur boosté et rôle boosteur. [OWNER]",
  category: "dev",
  aliases: ["ownconfig", "oc"],
  permissions: [],
  usage: "[panel|server <id>|role <id|@rôle>|reset]",
  slash: [
    {
      name: "action",
      description: "Action",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "server", value: "server" },
        { name: "role", value: "role" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "id", description: "ID du serveur ou du rôle", type: ApplicationCommandOptionType.String, required: false },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    if (!config.ownerId.includes(_message.author.id)) return

    console.log(
      `Command own-config used by ${_message.author.tag} (${_message.author.id}) in the guild ${_message.guild?.name} (${_message.guild?.id}${_message.guild?.vanityURLCode ? ` / .gg/${_message.guild?.vanityURLCode}` : ""})`
    )

    const sub = (args[0] ?? "panel").toLowerCase()

    if (sub === "server" || sub === "guild" || sub === "serveur") {
      const id = args[1]?.trim()
      if (!id || !/^\d{17,20}$/.test(id)) {
        return replyError(_message, "400 Bad Request", "> *Utilisez un ID de serveur valide : `own-config server <id>`.*")
      }
      const guild = client.guilds.cache.get(id)
      if (!guild) {
        return replyError(_message, "400 Bad Request", "> *Ce serveur est introuvable (le bot doit y être présent).*")
      }
      await setPremiumServer(guild.id)
      console.log(`Premium server set to ${guild.name} (${guild.id}) by ${_message.author.id}`)
      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# ${appEmojiText("check")} 〃 Serveur premium défini\n` +
              `> ***Serveur :** ${guild.name} (\`${guild.id}\`)*\n` +
              `> *Le rôle boosteur a été réinitialisé, définissez-le depuis le panneau \`${config.prefix}oc\`.*`,
            color: 0x2b2d31,
          },
        ],
      })
    }

    if (sub === "role" || sub === "roleid" || sub === "boostrole") {
      const roleId = roleToId(args[1] ?? "")
      if (!roleId) {
        return replyError(_message, "400 Bad Request", "> *Utilisez un ID ou une mention de rôle valide : `own-config role <id|@rôle>`.*")
      }
      const cfg = await getPremiumConfig()
      if (!cfg.premiumServerId) {
        return replyError(_message, "400 Bad Request", "> *Aucun serveur premium défini. Utilisez d'abord `own-config server <id>`.*")
      }
      const guild = client.guilds.cache.get(cfg.premiumServerId)
      const role = guild ? await guild.roles.fetch(roleId).catch(() => null) : null
      if (!role) {
        return replyError(_message, "400 Bad Request", "> *Ce rôle est introuvable sur le serveur premium.*")
      }
      await setBoosterRole(role.id)
      console.log(`Booster role set to ${role.name} (${role.id}) on ${guild?.name} by ${_message.author.id}`)
      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# ${appEmojiText("check")} 〃 Rôle boosteur défini\n` +
              `> ***Serveur premium :** ${guild?.name} (\`${guild?.id}\`)*\n` +
              `> ***Rôle boosteur :** ${role.name} ${role}*\n` +
              `> *Le système premium est désormais **actif** : les membres avec ce rôle sont premium.*`,
            color: 0x2b2d31,
          },
        ],
      })
    }

    if (sub === "reset" || sub === "clear") {
      await resetPremiumConfig()
      console.log(`Premium config reset by ${_message.author.id}`)
      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# ${appEmojiText("check")} 〃 Configuration premium réinitialisée\n` +
              `> *Serveur premium et rôle boosteur ont été effacés.*`,
            color: 0x2b2d31,
          },
        ],
      })
    }

    const cfg = await getPremiumConfig()
    const sent = await _message.reply({ components: buildPremiumContainer(client, cfg), flags: COMPONENTS_V2_FLAGS })
    panelRefs.set(_message.author.id, { channelId: sent.channel.id, messageId: sent.id })
  },

  async handleInteraction(client: Client, interaction: Interaction): Promise<boolean> {
    return handlePanelInteraction(client, interaction)
  },
}
