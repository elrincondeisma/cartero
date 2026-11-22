> 🌐 **English** · [Español](es/16-preguntas-frecuentes.md)

# FAQ

## Installation and administration

**I opened Cartero for the first time and see a setup wizard instead of the login page.**
That's expected: a new instance asks you to create the admin account and choose the basic settings. See [First start](15-self-hosting.md#first-start-the-setup-wizard).

**Where do I change the settings I chose in the wizard?**
In **Administration** (account menu → Administration). Every setting is there, and you can reopen the wizard from the **System** tab.

**Do I still need to edit `.env`?**
Only for what the server needs before starting: `CARTERO_SECRET_KEY`, the database and Redis. Everything else (public URL, sign-up, Google and GitHub, email, security) is set in Administration. See [Environment variables](15-self-hosting.md#environment-variables).

**Administration says I'm using the development encryption key.**
Set `CARTERO_SECRET_KEY` in `.env` to a long random value (`openssl rand -base64 32`) and restart. Do it before storing real secrets: anything encrypted with the old key can't be read with the new one.

**I lost the admin password, or nobody is admin.**
Use the rescue commands from the server's terminal: [If nobody can get in](17-admin-and-social-login.md#if-nobody-can-get-in).

**"Continue with Google" says the redirect URL doesn't match.**
The callback URL registered in Google or GitHub must be exactly the one shown in **Administration → Sign-in**. If you changed the public URL, update it there too.

**The test email fails.**
Cartero shows the mail server's answer. The usual causes: wrong port (465 needs `smtps://`, 587 needs `smtp://`), a password with special characters that must be URL-encoded, or a provider that requires an app password.

**Why can't some people sign up?**
Check **Administration → Sign-in**: sign-up may be closed or limited to some email domains. Invitations always work.

## Using Cartero


**Will my Postman scripts work?**
Yes. Cartero uses the same execution engine as Postman (`postman-runtime`), with the full `pm.*` API and the same libraries available via `require`.

**Why are requests sent from the server instead of my browser?**
No CORS issues, cookies, self-signed certificates and every auth method just work, and you can call APIs on the server's network (your LAN, for example). If your instance is public, an admin can block private networks in **Administration → Security**.

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
