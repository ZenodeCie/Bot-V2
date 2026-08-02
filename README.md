# ZenodeBot V2

Bot Discord écrit en TypeScript avec [discord.js](https://discord.js.org/) et [Mongoose](https://mongoosejs.com/) (MongoDB).

## Prérequis

- Node.js 20+
- MongoDB (local ou [MongoDB Atlas](https://www.mongodb.com/atlas))

## Installation

```bash
npm install
```

## Configuration

Créez un fichier `.env` à la racine (copiez depuis `.env.example`) :

```env
BOT_TOKEN=votre_token_ici
MONGODB_URI=mongodb://localhost:27017/znd-v2
```

| Variable       | Description                                        |
| -------------- | -------------------------------------------------- |
| `BOT_TOKEN`    | Token du bot Discord (Discord Developer Portal)    |
| `MONGODB_URI`  | URI de connexion MongoDB (nom de la DB : `znd-v2`) |

## Utilisation

```bash
npm run build   # compile TypeScript vers dist/
npm run dev     # compile en mode watch
npm start       # lance le bot (node dist/index.js)
```

## Structure

```
src/
├── index.ts                 # Point d'entrée : connexion MongoDB + login Discord
├── config.ts                # Config (token, URI MongoDB, préfixe par défaut)
├── types.d.ts               # Types globaux (Command, Client étendu, etc.)
├── commands/                # Commandes prefix, organisées par catégorie
├── events/                  # Events Discord (messageCreate, interactionCreate, ready)
└── utils/
    ├── mongoClient.ts       # Client/connexion MongoDB (exporté en default)
    ├── initData.ts          # Crée les collections si elles n'existent pas au démarrage
    ├── errorEmbed.ts        # Générateur d'embeds d'erreur
    └── formatTime.ts        # Formate une durée en millisecondes
```

## Fonctionnalités

- **Préfixe par serveur** : la commande `prefix` permet de changer le préfixe d'un serveur (stocké en base, admin requis).
- **Interactions persistantes** : chaque commande peut exporter un `handleInteraction` ; l'event `interactionCreate` les dispatch automatiquement, les boutons/select menus restent donc actifs après redémarrage.
- **Collections auto-créées** : au démarrage, `initData()` garantit l'existence des collections nécessaires.

### Ajouter une commande

Créez un fichier dans `src/commands/<categorie>/` exportant en default un objet avec `name`, `description`, `category`, `aliases`, `permissions`, `usage` et `execute(client, message, args)`.

Exemple d'interactions :

```ts
export async function handleInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false
  if (interaction.customId !== "mon-bouton") return false
  await interaction.reply("Bouton cliqué !")
  return true
}
```
