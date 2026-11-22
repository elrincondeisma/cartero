# Authentication

Pick the type in the **Authorization** tab of a request, folder or collection. Every field supports `{{variables}}`: keep passwords and tokens in **secret** environment variables.

## Inheritance

A request set to **"Inherit from parent"** uses its folder's auth; if the folder also inherits, the collection's. That way you configure the token once on the collection. Use **"No auth"** to exclude a specific request.

## Available types

| Type | What it sends |
|---|---|
| **Basic Auth** | `Authorization: Basic base64(user:password)` |
| **Bearer Token** | `Authorization: Bearer <token>` |
| **API Key** | A header or query param with the name you choose (e.g. `X-API-Key`) |
| **JWT Bearer** | Signs a JWT with your secret or private key (HS/RS/ES/PS) and sends it as Bearer |
| **Digest** | Digest challenge-response (MD5, SHA-256…) |
| **OAuth 1.0** | HMAC-SHA1/256/512, RSA or PLAINTEXT signatures |
| **OAuth 2.0** | See below |
| **Hawk**, **AWS Signature v4**, **NTLM**, **Akamai EdgeGrid** | Each service's signature scheme |

## OAuth 2.0

1. Choose **OAuth 2.0**. If you already have a token, paste it into *Access token*.
2. To get a new one, fill in the **"Get a new token"** block:
   - **Authorization Code** (with or without **PKCE**): a window opens to sign in with the provider. Register `https://YOUR-CARTERO/oauth/callback` as the *callback*.
   - **Client Credentials** and **Password**: Cartero requests the token from the server, no window needed.
   - **Implicit**: the token arrives directly in the redirect.
3. Click **Request token**. If the provider returns a *refresh token*, **Refresh token** appears.

The token is added as an `Authorization: Bearer …` header (or as a query param, if you choose).
