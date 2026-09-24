import { defaultEmbed, defaultEntry, defaultResponses, type PanelLanguage, type PanelMode, type RolePanel } from "./schema.js"

/** Modèles de panel prêts à l'emploi (FR/EN) — seed d'embed + entrées exemples. */

export interface PanelTemplate {
  key: string
  name: string
  mode: PanelMode
  apply(panel: RolePanel): void
}

export function panelTemplates(language: PanelLanguage = "fr"): PanelTemplate[] {
  const french = language === "fr"
  const templates: PanelTemplate[] = [
    {
      key: "libre",
      name: french ? "Libre (vierge)" : "Blank (free-form)",
      mode: "normal",
      apply(panel: RolePanel) {
        panel.embed = defaultEmbed(language)
      },
    },
    {
      key: "roles",
      name: french ? "Choix de rôles (normal)" : "Role picker (normal)",
      mode: "normal",
      apply(panel: RolePanel) {
        panel.embed = {
          ...defaultEmbed(language),
          title: french ? "Choisissez vos rôles" : "Pick your roles",
          description: french
            ? "Cliquez sur un bouton ou réagissez avec un emoji pour obtenir votre rôle.\nUtilisez à nouveau pour le retirer."
            : "Click a button or react with an emoji to get your role.\nUse it again to remove it.",
          color: "#5865f2",
        }
        panel.entries = [defaultEntry("button", { label: french ? "Membre" : "Member" })]
      },
    },
    {
      key: "region",
      name: french ? "Régions (réactions)" : "Regions (reactions)",
      mode: "normal",
      apply(panel: RolePanel) {
        panel.embed = {
          ...defaultEmbed(language),
          title: french ? "Vos régions" : "Your region",
          description: french
            ? "Réagissez avec le drapeau correspondant pour recevoir le rôle de votre région."
            : "React with the matching flag to receive your region role.",
          color: "#57f287",
        }
        panel.entries = [
          defaultEntry("reaction", { label: french ? "France" : "France", emoji: { name: "🇫🇷", id: null, animated: false } }),
          defaultEntry("reaction", { label: french ? "Belgique" : "Belgium", emoji: { name: "🇧🇪", id: null, animated: false } }),
          defaultEntry("reaction", { label: french ? "Canada" : "Canada", emoji: { name: "🇨🇦", id: null, animated: false } }),
          defaultEntry("reaction", { label: french ? "Afrique" : "Africa", emoji: { name: "🌍", id: null, animated: false } }),
        ]
      },
    },
    {
      key: "unique",
      name: french ? "Choix unique (un seul rôle)" : "Unique (single choice)",
      mode: "unique",
      apply(panel: RolePanel) {
        panel.embed = {
          ...defaultEmbed(language),
          title: french ? "Choisissez UNE équipe" : "Pick ONE team",
          description: french
            ? "Sélectionnez une seule équipe dans le menu ci-dessous — changer remplace l'ancienne."
            : "Select a single team from the menu below — changing replaces the previous one.",
          color: "#fee75c",
        }
        panel.entries = [defaultEntry("select", { label: french ? "Choisir une équipe" : "Choose a team" })]
      },
    },
    {
      key: "notifications",
      name: french ? "Notifications" : "Notifications",
      mode: "normal",
      apply(panel: RolePanel) {
        panel.embed = {
          ...defaultEmbed(language),
          title: french ? "Notifications" : "Notifications",
          description: french
            ? "Recevez une notification quand un nouvel annonce est posté."
            : "Get notified when a new announcement is posted.",
          color: "#ed4245",
        }
        panel.entries = [defaultEntry("button", { label: french ? "Annonces" : "Announcements" })]
      },
    },
  ]
  return templates
}

export function applyTemplate(panel: RolePanel, key: string): PanelTemplate | null {
  const template = panelTemplates(panel.language).find((item) => item.key === key)
  if (!template) return null
  template.apply(panel)
  panel.mode = template.mode
  panel.responses = defaultResponses(panel.language)
  return template
}
