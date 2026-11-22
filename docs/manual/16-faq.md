> 🌐 **English** · [Español](es/16-preguntas-frecuentes.md)

# FAQ

**Will my Postman scripts work?**
Yes. Cartero uses the same execution engine as Postman (`postman-runtime`), with the full `pm.*` API and the same libraries available via `require`.

**Why are requests sent from the server instead of my browser?**
No CORS issues, cookies, self-signed certificates and every auth method just work, and you can call APIs on the server's network (your LAN, for example). If your instance is public, the admin can block private networks with `BLOCK_PRIVATE_NETWORKS=true`.

**Can I test an API that only runs on my computer (localhost)?**
Only if Cartero runs on that same computer or network. For an API on your laptop and Cartero on a server, expose the API on the network (or your Tailscale) and use that address.

**Are there limits on runs, mocks or monitors?**
No. The only limit is your server's capacity.

**Where is my data stored?**
In your server's PostgreSQL database. Secret variables are encrypted with AES-256-GCM.

**I see "Someone else made changes". What do I do?**
Someone saved the same request while you were editing it. Click the notice to load their version (you'll lose your unsaved changes), or save and choose **Overwrite** to keep yours. If you make a mistake, you can restore any version from **Changes**.

**A test fails with "pm.response is undefined".**
You're using `pm.response` in the *Pre-request* script: the response only exists in *Post-response*.

**How do I see exactly what was sent, with variables substituted?**
In the response, **Details** tab.

**Can I undo a deletion?**
Yes: the request's comments and changes panel, or the collection's **Activity** → **Restore**.

**How do I remove the sample data?**
**Settings → Workspace → Sample data → Remove sample data**.

**How do I change the language?**
From the account menu (top right) or **Settings → My profile → Interface language**.

**Is it safe to connect an AI assistant?**
It uses its own revocable token, acts with your permissions, can't delete anything and never sees secrets. See [Connecting AI assistants](13-ai-mcp.md).
