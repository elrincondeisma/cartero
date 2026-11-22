> 🌐 **English** · [Español](es/17-administracion-y-login-social.md)

# Administration

Everything about how your Cartero works is set in **Administration**: its name and address, who can sign up, Google and GitHub sign-in, email and security. You set it up once in the [setup wizard](15-self-hosting.md#first-start-the-setup-wizard), and you can change it here at any time.

## Two kinds of roles

- **Instance role**: *Admin* or *User*. It decides who can manage Cartero itself.
- **Workspace role**: owner, admin, editor or viewer. It decides what each person can do inside a workspace ([Teams and collaboration](11-teams-and-collaboration.md)).

Being an instance admin doesn't give you access to other people's workspaces.

**Who is an admin:** the account created in the setup wizard (or the first account on the instance). If no admin is left when the server starts, the oldest account becomes one, so the instance is never locked. You can also list admins in `ADMIN_EMAILS`.

## Opening Administration

Admins see **Administration** in the account menu (your initials, top right) and in the command palette (`Ctrl+K`). It lives at `/admin`. The help menu (**?**) also has the **Admin guide** (this page) and the **Setup wizard**.

## Tabs

### General
- **Instance name**: shown in emails and in the browser tab.
- **Public URL**: the address people use to reach Cartero. It's used in invitation links, Google and GitHub callbacks and monitor alerts. If you've opened Cartero from a different address, Cartero suggests it.

### Users
All the accounts, with how they sign in (password, Google, GitHub), their role, status and last session. From the `⋯` menu of each account:
- **Make admin / Remove admin.**
- **Disable account**: closes their sessions and stops them signing in, without deleting anything. **Reactivate** undoes it.
- **Delete user**: deletes the account and its personal workspaces. Team workspaces stay with the other members.

You can't remove your own admin role, disable or delete your own account, and the last admin can't be demoted.

### Sign-in
- **Who can create an account**:
  - **Open**: anyone who can reach the URL.
  - **Only my company**: only emails from the domains you list (`company.com, company.es`), subdomains included.
  - **Closed**: only existing accounts and people invited to a workspace.

  Invitations always work, whatever you choose.
- **Google** and **GitHub**: see below.

### Email
The SMTP server Cartero uses to send invitations and monitor alerts. Write the server as a URL with the user and password inside, for example `smtps://user:password@smtp.example.com:465`, and the sender (`Cartero <no-reply@company.com>`). **Test** sends an email to you with what you've typed, before saving. The URL is stored encrypted.

Without email, Cartero still works: invitations are shared as a link.

### Security
- **Private network, VPN or homelab**: requests can reach your local network (`localhost`, `192.168.x.x`…), handy for testing internal services.
- **Exposed to the Internet**: Cartero blocks requests to private IPs so nobody can use it to reach your network (SSRF protection). Recommended if anyone can sign up.

The change applies immediately to new requests, runs and monitors.

### System
The server's status: database, Redis (needed for scheduled monitors), the encryption key, production or development mode, secure cookies, files folder and version. These are set with environment variables because the server needs them before it starts (see [Installation](15-self-hosting.md#environment-variables)). If you're still using the development encryption key, you'll see a warning here.

From here you can also open the **setup wizard** again to go through everything step by step.

## Set up Google

1. Open [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials) and create an **OAuth client ID** of type **Web application**. If you're asked to, set up the consent screen first.
2. Under **Authorized redirect URIs**, paste the **callback URL** shown in Cartero. It looks like `https://your-cartero/api/auth/oauth/google/callback`.
3. Copy the **Client ID** and **Client secret** into Cartero, save, and turn Google on.

## Set up GitHub

1. Open [GitHub → New OAuth App](https://github.com/settings/applications/new) (or the same page in your organization's settings).
2. **Homepage URL**: your Cartero URL. **Authorization callback URL**: the **callback URL** shown in Cartero (`…/api/auth/oauth/github/callback`).
3. Generate a **Client secret**, copy it and the **Client ID** into Cartero, save, and turn GitHub on.

> The callback URL is built from the **public URL** (General tab). If you change your address, update the redirect URL in Google and GitHub too.

## How social login works

When someone clicks **Continue with Google** or **Continue with GitHub**:

1. If that Google or GitHub account is already linked, they sign in.
2. If its **verified email** matches an existing account, it gets linked to that account and they sign in.
3. If not, a new account is created, but only if sign-up allows it or they have an invitation.

Accounts without a verified email are rejected. Accounts created with Google or GitHub don't have a password; they can set one in **Settings → My profile**. There, under **Connected accounts**, each person can link or unlink Google and GitHub (Cartero won't let you unlink your only way of signing in).

## If nobody can get in

From the server's terminal:

```bash
# Docker
docker compose exec cartero node dist/scripts/admin.js list
docker compose exec cartero node dist/scripts/admin.js promote  --email you@example.com
docker compose exec cartero node dist/scripts/admin.js password --email you@example.com

# From the source code
pnpm --filter @cartero/server admin password --email you@example.com
```

`password` sets a new random password (or the one you pass with `--password`), prints it and closes that account's sessions. `promote` makes an account admin and reactivates it.
