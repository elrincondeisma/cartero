> 🌐 **English** · [Español](es/17-administracion-y-login-social.md)

# Administration and social login

Cartero has two kinds of roles:

- **Instance role**: *Admin* or *User*. It decides who can manage Cartero itself: accounts, sign-up and sign-in methods.
- **Workspace role**: owner, admin, editor or viewer. It decides what each person can do inside a workspace ([Teams and collaboration](11-teams-and-collaboration.md)).

Being an instance admin doesn't give you access to other people's workspaces.

## Who is an admin

- The **first account** created on the instance is an admin.
- If no admin is left when the server starts, the oldest account becomes one, so the instance is never locked.
- You can also list admins in the `ADMIN_EMAILS` variable (comma-separated). Those accounts are promoted every time the server starts.

## The administration panel

Admins see **Administration** in the account menu (your initials, top right), and in the command palette (`Ctrl+K`). It lives at `/admin` and has two tabs.

### Users

All the accounts on the instance, with how they sign in (password, Google, GitHub), their role, their status and their last session. From the `⋯` menu of each account you can:

- **Make admin / Remove admin.**
- **Disable account**: closes their sessions and stops them signing in, without deleting anything. **Reactivate** undoes it.
- **Delete user**: deletes the account and its personal workspaces. Team workspaces stay with the other members.

To avoid locking yourself out, you can't remove your own admin role, disable or delete your own account, and the last admin can't be demoted.

### Sign-in

- **Open sign-up**: if it's off, only existing accounts and people invited to a workspace can get in. It replaces the `ALLOW_REGISTRATION` variable, which is now just the initial value.
- **Allowed domains**: if you add any (`company.com, company.es`), new accounts must use an email from those domains, subdomains included. Invitations aren't affected.
- **Google** and **GitHub**: turn each one on, paste its credentials and save. The Client secret is stored encrypted and never shown again.

## Set up Google

1. Open [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials) and create an **OAuth client ID** of type **Web application**. If you're asked to, set up the consent screen first.
2. Under **Authorized redirect URIs**, paste the **callback URL** shown in the panel. It looks like `https://your-cartero/api/auth/oauth/google/callback`.
3. Copy the **Client ID** and **Client secret** into the panel, save, and turn Google on.

## Set up GitHub

1. Open [GitHub → New OAuth App](https://github.com/settings/applications/new) (or the same page in your organization's settings).
2. **Homepage URL**: the URL of your Cartero. **Authorization callback URL**: the **callback URL** shown in the panel (`…/api/auth/oauth/github/callback`).
3. Generate a **Client secret**, copy it and the **Client ID** into the panel, save, and turn GitHub on.

> The callback URL is built from `PUBLIC_URL`. If you change your domain, update `PUBLIC_URL` and the redirect URL in Google and GitHub.

You can also provide the credentials as environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`). Whatever you save in the panel takes priority.

## How social login works

When someone clicks **Continue with Google** or **Continue with GitHub**:

1. If that Google or GitHub account is already linked, they sign in.
2. If its **verified email** matches an existing account, it gets linked to that account and they sign in.
3. If not, a new account is created, but only if sign-up is open (and the domain allowed) or they have an invitation.

Accounts without a verified email are rejected. Accounts created with Google or GitHub don't have a password. They can set one in **Settings → My profile**.

## Connected accounts

In **Settings → My profile → Connected accounts**, each person can link or unlink Google and GitHub. Cartero won't let you unlink your only way of signing in: set a password first.
