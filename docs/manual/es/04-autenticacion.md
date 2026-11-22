> 🌐 [English](../04-authentication.md) · **Español**

# Autenticación

Elige el tipo en la pestaña **Autorización** de una petición, carpeta o colección. Todos los campos admiten `{{variables}}`: guarda contraseñas y tokens en variables **secretas** del entorno.

## Herencia

Una petición con **«Heredar del padre»** usa la autenticación de su carpeta; si la carpeta también hereda, la de la colección. Así configuras el token una sola vez en la colección. Usa **«Sin autenticación»** para excluir una petición concreta.

## Tipos disponibles

| Tipo | Qué envía |
|---|---|
| **Basic Auth** | `Authorization: Basic base64(usuario:contraseña)` |
| **Bearer Token** | `Authorization: Bearer <token>` |
| **API Key** | Una cabecera o query param con el nombre que elijas (p. ej. `X-API-Key`) |
| **JWT Bearer** | Firma un JWT con tu secreto o clave privada (HS/RS/ES/PS) y lo envía como Bearer |
| **Digest** | Desafío-respuesta Digest (MD5, SHA-256…) |
| **OAuth 1.0** | Firma HMAC-SHA1/256/512, RSA o PLAINTEXT |
| **OAuth 2.0** | Ver abajo |
| **Hawk**, **AWS Signature v4**, **NTLM**, **Akamai EdgeGrid** | Las firmas de cada servicio |

## OAuth 2.0

1. Elige **OAuth 2.0**. Si ya tienes un token, pégalo en *Access token*.
2. Para obtener uno nuevo, rellena el bloque **«Obtener un token nuevo»**:
   - **Authorization Code** (con o sin **PKCE**): se abre una ventana para iniciar sesión en el proveedor. Registra como *callback* `https://TU-CARTERO/oauth/callback`.
   - **Client Credentials** y **Password**: Cartero pide el token desde el servidor, sin ventana.
   - **Implicit**: el token llega directamente en la redirección.
3. Pulsa **Pedir token**. Si el proveedor da *refresh token*, aparece **Refrescar token**.

El token se añade como cabecera `Authorization: Bearer …` (o como query param, si lo eliges).
