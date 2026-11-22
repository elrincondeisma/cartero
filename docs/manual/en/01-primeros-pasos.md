# Getting started

Cartero is an API client: you build HTTP requests, send them, inspect the response and automate tests. It runs in the browser and your data lives on your own server.

## Create your account

1. Open your Cartero address and click **Sign up**.
2. Enter your name, email and a password of at least 8 characters.
3. A **personal workspace**, just for you, is created when you sign in.

The first time, a wizard offers three options:

- **Import from Postman**: bring your collections and environments (see [Collections and import](06-colecciones-e-importacion.md)).
- **See a full example**: creates a "Demo Cartero" workspace built on real public APIs, with tests, environments, a mock, monitors and documentation. Remove it with one click in **Settings → Workspace → Sample data**.
- **Start from scratch**.

Then it offers a **guided tour** of the interface. You can replay it anytime from the help button **(?)**.

## Language

Cartero is available in **English** and **Spanish**. Switch from the account menu (top right), from **Settings → My profile**, or from the links under the sign-in form. Your choice is saved to your account.

## The screen

| Area | What it's for |
|---|---|
| **Top bar** | Switch workspace, search (Ctrl+K), help, pick the active environment and view its variables (👁), light/dark theme and your account |
| **Left rail** | Sections: Collections, Environments, History, Runs, Mock servers, Monitors and Settings |
| **Sidebar** | The section's content: collection tree, environment list or history |
| **Tabs** | Open requests, folders, collections, environments and runs |

## Your first request

1. Click **+** in the tab bar (or **Ctrl+T**).
2. Type a URL, for example `https://jsonplaceholder.typicode.com/posts/1`.
3. Click **Send** (or **Ctrl+Enter**).
4. Below you'll see the status code, time, size and formatted body.
5. Click **Save** (Ctrl+S), give it a name and pick a collection.

> **Tip:** if you have a `curl` command (from an API's docs or your browser's dev tools), paste it straight into the URL bar and Cartero turns it into a request.

## Find anything: Ctrl+K

The command palette finds requests by name or URL, activates environments, opens sections and runs actions (import, new request, theme, docs…). Type several words to narrow it down: `post create`.
