# ZenodeBot V2

Bot Discord écrit en TypeScript, construit avec [discord.js](https://discord.js.org/) et MongoDB via [Mongoose](https://mongoosejs.com/). Il propose une base simple et extensible pour des commandes à préfixe, avec une configuration propre à chaque serveur.

## Fonctionnalités

- Commandes Discord à préfixe, chargées automatiquement depuis `src/commands/`
- Préfixe personnalisable par serveur, enregistré dans MongoDB
- Commande d'aide avec menu de catégories interactif
- Gestion centralisée des interactions, qui reste fonctionnelle après un redémarrage
- Chargement automatique des événements Discord et initialisation de la collection MongoDB nécessaire

## Prérequis

- [Node.js](https://nodejs.org/) 20 ou version plus récente
- Une application Discord et son token de bot
- Une instance MongoDB locale ou une base [MongoDB Atlas](https://www.mongodb.com/atlas)

> Le bot utilise l'intent **Message Content**. Activez-le dans le portail développeur Discord, dans **Bot → Privileged Gateway Intents**, sinon les commandes à préfixe ne pourront pas être lues.

## Installation rapide

```bash
git clone <url-du-depot>
cd Bot-V2
npm install
```

Copiez ensuite le fichier d'exemple :

```bash
cp .env.example .env
```

Sous PowerShell :

```powershell
Copy-Item .env.example .env
```

Renseignez le fichier `.env` :

```env
BOT_TOKEN=votre_token_discord
MONGODB_URI=mongodb://localhost:27017/znd-v2
```

| Variable | Requise | Rôle |
| --- | --- | --- |
| `BOT_TOKEN` | Oui | Token de l'application Discord. Ne le partagez jamais et ne le versionnez pas. |
| `MONGODB_URI` | Oui | Chaîne de connexion MongoDB. |

## Lancer le bot

Compilez le projet puis démarrez-le :

```bash
npm run build
npm start
```

Pour recompiler automatiquement les fichiers TypeScript pendant le développement :

```bash
npm run dev
```

Dans un second terminal, utilisez `npm start` après chaque compilation réussie. Le dossier `dist/` est généré par TypeScript et contient les fichiers exécutés par Node.js.

## Commandes disponibles

Le préfixe initial est `.`. Chaque serveur peut le remplacer avec la commande `prefix`.

| Commande | Alias | Description |
| --- | --- | --- |
| `.help [commande]` | `h`, `aide` | Affiche l'aide, les catégories ou le détail d'une commande. |
| `.ping` | `latency`, `bot-latency` | Affiche la latence du bot et son temps de fonctionnement. |
| `.prefix [nouveau-préfixe]` | `setprefix`, `prefixe`, `préfix` | Affiche ou change le préfixe du serveur. Réservé aux administrateurs. |

Exemple :

```text
.prefix !
!help ping
!ping
```

Le nouveau préfixe est enregistré dans la collection MongoDB `guilds`. Il peut comporter jusqu'à 10 caractères.

## Structure du projet

```text
src/
├── index.ts                  # Démarrage : MongoDB, chargement, connexion Discord
├── config.ts                 # Lecture des variables d'environnement et configuration par défaut
├── types.d.ts                # Types partagés des commandes et du client Discord
├── commands/
│   └── utils/                # Commandes intégrées : help, ping, prefix
├── events/                   # Événements Discord : ready, messageCreate, interactionCreate
└── utils/
    ├── mongoClient.ts        # Connexion Mongoose
    ├── initData.ts           # Modèle Guild et création de la collection guilds
    ├── errorEmbed.ts         # Embeds d'erreur
    └── formatTime.ts         # Formatage des durées
```

## Ajouter une commande

Créez un fichier dans `src/commands/<catégorie>/`. Il doit exporter par défaut un objet conforme à l'interface `Command` :

```ts
import type { Client, Message } from "discord.js"

export default {
  name: "bonjour",
  description: "Salue l'utilisateur.",
  category: "fun",
  aliases: ["salut"],
  permissions: [],
  usage: "",
  async execute(_client: Client, message: Message) {
    await message.reply("Bonjour !")
  },
}
```

Les fichiers JavaScript générés dans `dist/commands/` sont détectés automatiquement au lancement.

### Ajouter une interaction

Une commande peut également exporter `handleInteraction`. Elle doit retourner `true` lorsqu'elle a traité l'interaction ; les autres gestionnaires ne seront alors pas appelés.

```ts
import type { Client, Interaction } from "discord.js"

export async function handleInteraction(
  _client: Client,
  interaction: Interaction
): Promise<boolean> {
  if (!interaction.isButton() || interaction.customId !== "bonjour") return false

  await interaction.reply({ content: "Bonjour !", ephemeral: true })
  return true
}
```

## Dépannage

| Symptôme | Vérification |
| --- | --- |
| Le bot s'arrête immédiatement | Vérifiez `BOT_TOKEN` et `MONGODB_URI` dans `.env`. |
| Le bot est connecté mais ignore les messages | Activez **Message Content Intent** sur le portail développeur Discord et vérifiez le préfixe du serveur. |
| La connexion MongoDB échoue | Vérifiez l'URI, l'accès réseau et les identifiants de la base. |
| Une nouvelle commande n'apparaît pas | Lancez `npm run build`, puis redémarrez le bot. |

## Scripts

| Script | Action |
| --- | --- |
| `npm run build` | Compile TypeScript dans `dist/`. |
| `npm run dev` | Lance la compilation TypeScript en surveillance. |
| `npm start` | Exécute `dist/index.js`. |

## Sécurité

- Conservez `.env` hors de Git ; le fichier est déjà ignoré par le projet.
- Révoquez et remplacez immédiatement un token Discord exposé.
- Donnez au bot uniquement les permissions Discord dont il a besoin.
