> 🌐 **English** · [Español](es/06-colecciones-e-importacion.md)

# Collections and import

## Collections and folders

A **collection** groups requests and can contain nested folders. Each collection and folder has its own settings (double-click a folder, or ··· menu → *Settings*):

- **Overview**: Markdown description (shown in the published documentation) and the list of requests.
- **Authorization**: inherited by the requests inside.
- **Scripts**: run for every request inside.
- **Variables**: collection or folder variables.
- **Documentation** (collections only): see [Public documentation](10-public-docs.md).
- **Activity**: change history and comments.

In the tree:
- **Drag** requests and folders to reorder them or move them into another folder (the orange line shows where it will land; over a folder, inside it).
- **···** menu: new request or folder, run, rename, duplicate, fork, export and delete.
- **Filter requests**: search by name or URL.

## Import

Click the import icon in the Collections sidebar (or Ctrl+K → *Import*). There are three ways: **files** (drag or choose), **paste text** or **URL**. The format is detected automatically.

| Format | What gets imported |
|---|---|
| **Postman** v1, v2.0 and v2.1 collections | Everything: folders, requests, auth, scripts, variables, examples and descriptions |
| **Postman** environments and globals | Variables (secret ones stay secret) |
| **Postman** data-export ZIP | Every collection and environment in your account at once |
| **Insomnia** v4 (JSON) and v5 (YAML) | Folders, requests, auth, scripts; the base environment becomes collection variables and sub-environments become environments |
| **OpenAPI** 3.0/3.1 and **Swagger** 2.0 (JSON or YAML) | One request per operation, grouped by *tags*, with examples and a [contract](19-contracts.md) taken from the schemas |
| **cURL** | One request |
| Cartero workspace export | The whole workspace |

## Migrating from Postman, step by step

The fastest way is to **connect your Postman account**: Cartero reads your workspaces through the Postman API, with nothing to export.

1. In Postman, open [your API keys](https://go.postman.co/settings/me/api-keys), click **Generate API Key** and copy it.
2. In Cartero: **Import → Connect your Postman account** and paste the key.
3. Tick the workspaces you want. For each one you can untick collections or environments, keep or skip the global variables, and choose where it goes: a **new workspace** with the same name or one you already have.
4. Click **Import** and watch the progress. At the end you'll see what was created, what was updated and anything that failed (one item failing doesn't stop the rest).

Good to know:

- **Importing again updates instead of duplicating.** Cartero remembers what came from Postman: next time, those collections and environments are replaced in place (same id, so monitors, mocks and links keep working) and are marked *updates* before you start.
- **Your key isn't stored.** It's only used during the import and forgotten when you close the window. You can delete it in Postman afterwards.
- **Not everything leaves Postman.** The *current* values of variables and Vault secrets never reach Postman's cloud, so only initial values arrive; secret variables that arrive empty are flagged so you can fill them in. Mocks, monitors and API specs aren't imported: create them in Cartero from the collections.
- Each import uses a few calls from your Postman API quota (shown in the wizard): one per collection and environment, plus a few to list workspaces.

**Without an API key:** in Postman go to **Settings → Data → Export data**, select collections and environments, and drop the ZIP you get by email into **Import → Files**. Or export each collection on its own (··· → *Export* → *Collection v2.1*) and import it.

## Export

- A collection: ··· menu → **Export (Postman v2.1)**. The file can be imported into Postman and any compatible tool. The round trip is **lossless**.
- An environment: in the Environments section, ··· menu → **Export**.
- The whole workspace (backup): **Settings → Workspace → Export workspace**.

## Fork and merge

- **Fork**: copies a collection (to this or another workspace) so you can make changes without affecting the original.
- **Merge into source**: the fork's ··· menu. The original collection ends up identical to the fork. A revision is saved, so you can undo it from the change history.
