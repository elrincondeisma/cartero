> 🌐 [English](../17-admin-and-social-login.md) · **Español**

# Administración y login social

Cartero tiene dos tipos de rol:

- **Rol en la instancia**: *Admin* o *Usuario*. Decide quién puede gestionar el propio Cartero: cuentas, registro y formas de entrar.
- **Rol en el workspace**: propietario, admin, editor o lector. Decide qué puede hacer cada persona dentro de un workspace ([Equipos y colaboración](11-equipos-y-colaboracion.md)).

Ser admin de la instancia no da acceso a los workspaces de los demás.

## Quién es admin

- La **primera cuenta** que se crea en la instancia es admin.
- Si al arrancar el servidor no queda ningún admin, pasa a serlo la cuenta más antigua, para que la instancia nunca quede bloqueada.
- También puedes poner los admins en la variable `ADMIN_EMAILS` (separados por comas). Esas cuentas pasan a admin cada vez que arranca el servidor.

## El panel de administración

Los admins ven **Administración** en el menú de la cuenta (tus iniciales, arriba a la derecha) y en la paleta de comandos (`Ctrl+K`). Está en `/admin` y tiene dos pestañas.

### Usuarios

Todas las cuentas de la instancia, con cómo entran (contraseña, Google, GitHub), su rol, su estado y su última sesión. Desde el menú `⋯` de cada cuenta puedes:

- **Hacer admin / Quitar admin.**
- **Desactivar cuenta**: cierra sus sesiones y le impide entrar, sin borrar nada. **Reactivar** lo deshace.
- **Borrar usuario**: borra la cuenta y sus workspaces personales. Los workspaces de equipo se quedan con el resto de miembros.

Para que no te quedes fuera, no puedes quitarte el rol de admin, ni desactivar o borrar tu propia cuenta, y el último admin no puede dejar de serlo.

### Inicio de sesión

- **Registro abierto**: si lo apagas, solo pueden entrar las cuentas que ya existen y las personas invitadas a un workspace. Sustituye a la variable `ALLOW_REGISTRATION`, que ahora solo es el valor inicial.
- **Dominios permitidos**: si pones alguno (`empresa.com, empresa.es`), las cuentas nuevas tienen que usar un email de esos dominios, subdominios incluidos. Las invitaciones no se ven afectadas.
- **Google** y **GitHub**: activa cada uno, pega sus credenciales y guarda. El Client secret se guarda cifrado y no se vuelve a mostrar.

## Configurar Google

1. Abre [Google Cloud → Credenciales](https://console.cloud.google.com/apis/credentials) y crea un **ID de cliente de OAuth** de tipo **Aplicación web**. Si te lo pide, configura antes la pantalla de consentimiento.
2. En **URIs de redireccionamiento autorizados**, pega la **URL de callback** que muestra el panel. Es del estilo `https://tu-cartero/api/auth/oauth/google/callback`.
3. Copia el **Client ID** y el **Client secret** en el panel, guarda y activa Google.

## Configurar GitHub

1. Abre [GitHub → New OAuth App](https://github.com/settings/applications/new) (o la misma página en los ajustes de tu organización).
2. **Homepage URL**: la URL de tu Cartero. **Authorization callback URL**: la **URL de callback** que muestra el panel (`…/api/auth/oauth/github/callback`).
3. Genera un **Client secret**, cópialo junto al **Client ID** en el panel, guarda y activa GitHub.

> La URL de callback sale de `PUBLIC_URL`. Si cambias de dominio, actualiza `PUBLIC_URL` y la URL de redirección en Google y GitHub.

También puedes dar las credenciales con variables de entorno (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`). Lo que guardes en el panel tiene prioridad.

## Cómo funciona el login social

Cuando alguien pulsa **Continuar con Google** o **Continuar con GitHub**:

1. Si esa cuenta de Google o GitHub ya está vinculada, entra.
2. Si su **email verificado** coincide con una cuenta que ya existe, se vincula a ella y entra.
3. Si no, se crea una cuenta nueva, pero solo si el registro está abierto (y el dominio permitido) o tiene una invitación.

Las cuentas sin email verificado se rechazan. Las cuentas creadas con Google o GitHub no tienen contraseña. Pueden ponerla en **Ajustes → Mi perfil**.

## Cuentas conectadas

En **Ajustes → Mi perfil → Cuentas conectadas**, cada persona puede vincular o desvincular Google y GitHub. Cartero no te deja desvincular tu única forma de entrar: pon antes una contraseña.
