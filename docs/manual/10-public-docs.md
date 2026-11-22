> 🌐 **English** · [Español](es/10-documentacion-publica.md)

# Public documentation

Turn a collection into a documentation page you can share with anyone, even without an account.

## Publish

1. Open the collection's settings → **Documentation**.
2. Choose the **URL** (`/docs/my-api`).
3. Optional: an **environment** to show real variable values (e.g. the production base URL).
4. Optional: **password-protect** it.
5. Click **Publish**.

## What it includes

- The description of the collection and of every folder and request (in Markdown).
- For each request: method, URL, query params, headers, body, a copy-ready **cURL example** and the saved **example responses**.
- A navigable sidebar index, in light or dark theme.

## Security

Never published:
- the values of **secret** variables;
- passwords, tokens and keys typed directly into the auth settings (shown as `••••••`).

Regular variables from the chosen environment are shown. To take it down, click **Unpublish** or untick **Published**.

> Write good descriptions: use headings, lists, tables and code blocks in Markdown in the collection's *Overview* tab and in each request's *Description* tab.
