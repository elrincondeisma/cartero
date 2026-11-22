> 🌐 [English](../17-admin-and-social-login.md) · **Español**

# Administración

Todo lo que define cómo funciona tu Cartero se ajusta en **Administración**: su nombre y su dirección, quién puede registrarse, el login con Google y GitHub, el email y la seguridad. Lo configuras una vez en el [asistente de instalación](15-autoalojamiento.md#primer-arranque-el-asistente) y puedes cambiarlo aquí cuando quieras.

## Dos tipos de rol

- **Rol en la instancia**: *Admin* o *Usuario*. Decide quién puede gestionar el propio Cartero.
- **Rol en el workspace**: propietario, admin, editor o lector. Decide qué puede hacer cada persona dentro de un workspace ([Equipos y colaboración](11-equipos-y-colaboracion.md)).

Ser admin de la instancia no da acceso a los workspaces de los demás.

**Quién es admin:** la cuenta que se crea en el asistente de instalación (o la primera cuenta de la instancia). Si al arrancar el servidor no queda ningún admin, pasa a serlo la cuenta más antigua, para que la instancia nunca quede bloqueada. También puedes poner admins en `ADMIN_EMAILS`.

## Cómo se entra

Los admins ven **Administración** en el menú de la cuenta (tus iniciales, arriba a la derecha) y en la paleta de comandos (`Ctrl+K`). Está en `/admin`. En el menú de ayuda (**?**) tienes además la **Guía de administración** (esta página) y el **Asistente de instalación**.

## Pestañas

### General
- **Nombre de la instancia**: aparece en los emails y en la pestaña del navegador.
- **URL pública**: la dirección con la que se llega a Cartero. Se usa en los enlaces de invitación, los callbacks de Google y GitHub y los avisos de los monitores. Si has entrado por otra dirección, Cartero te la propone.

### Usuarios
Todas las cuentas, con cómo entran (contraseña, Google, GitHub), su rol, su estado y su última sesión. Desde el menú `⋯` de cada cuenta:
- **Hacer admin / Quitar admin.**
- **Desactivar cuenta**: cierra sus sesiones y le impide entrar, sin borrar nada. **Reactivar** lo deshace.
- **Borrar usuario**: borra la cuenta y sus workspaces personales. Los workspaces de equipo se quedan con el resto de miembros.

No puedes quitarte el rol de admin, ni desactivar o borrar tu propia cuenta, y el último admin no puede dejar de serlo.

### Inicio de sesión
- **Quién puede crear una cuenta**:
  - **Abierto**: cualquiera que llegue a la URL.
  - **Solo mi empresa**: solo emails de los dominios que pongas (`empresa.com, empresa.es`), subdominios incluidos.
  - **Cerrado**: solo las cuentas que ya existen y las personas invitadas a un workspace.

  Las invitaciones funcionan siempre, elijas lo que elijas.
- **Google** y **GitHub**: más abajo.

### Email
El servidor SMTP con el que Cartero envía las invitaciones y los avisos de los monitores. Escribe el servidor como una URL con el usuario y la contraseña dentro, por ejemplo `smtps://usuario:contraseña@smtp.ejemplo.com:465`, y el remitente (`Cartero <no-reply@empresa.com>`). **Probar** te envía un email con lo que hayas escrito, antes de guardar. La URL se guarda cifrada.

Sin email, Cartero funciona igual: las invitaciones se comparten con un enlace.

### Seguridad
- **Red privada, VPN o homelab**: las peticiones pueden llegar a tu red local (`localhost`, `192.168.x.x`…), útil para probar servicios internos.
- **Expuesta a Internet**: Cartero bloquea las peticiones a IPs privadas para que nadie lo use para entrar en tu red (protección SSRF). Recomendado si cualquiera puede registrarse.

El cambio se aplica al momento a las peticiones, ejecuciones y monitores nuevos.

### Sistema
El estado del servidor: base de datos, Redis (lo necesitan los monitores programados), la clave de cifrado, modo producción o desarrollo, cookies seguras, carpeta de ficheros y versión. Esto se configura con variables de entorno porque el servidor lo necesita antes de arrancar (mira [Instalación](15-autoalojamiento.md#variables-de-entorno)). Si sigues con la clave de cifrado de desarrollo, aquí verás un aviso.

Desde aquí también puedes volver a abrir el **asistente de instalación** para repasarlo todo paso a paso.

## Configurar Google

1. Abre [Google Cloud → Credenciales](https://console.cloud.google.com/apis/credentials) y crea un **ID de cliente de OAuth** de tipo **Aplicación web**. Si te lo pide, configura antes la pantalla de consentimiento.
2. En **URIs de redireccionamiento autorizados**, pega la **URL de callback** que muestra Cartero. Es del estilo `https://tu-cartero/api/auth/oauth/google/callback`.
3. Copia el **Client ID** y el **Client secret** en Cartero, guarda y activa Google.

## Configurar GitHub

1. Abre [GitHub → New OAuth App](https://github.com/settings/applications/new) (o la misma página en los ajustes de tu organización).
2. **Homepage URL**: la URL de tu Cartero. **Authorization callback URL**: la **URL de callback** que muestra Cartero (`…/api/auth/oauth/github/callback`).
3. Genera un **Client secret**, cópialo junto al **Client ID** en Cartero, guarda y activa GitHub.

> La URL de callback sale de la **URL pública** (pestaña General). Si cambias de dirección, actualiza también la URL de redirección en Google y GitHub.

## Cómo funciona el login social

Cuando alguien pulsa **Continuar con Google** o **Continuar con GitHub**:

1. Si esa cuenta de Google o GitHub ya está vinculada, entra.
2. Si su **email verificado** coincide con una cuenta que ya existe, se vincula a ella y entra.
3. Si no, se crea una cuenta nueva, pero solo si el registro lo permite o tiene una invitación.

Las cuentas sin email verificado se rechazan. Las cuentas creadas con Google o GitHub no tienen contraseña; pueden ponerla en **Ajustes → Mi perfil**. Ahí, en **Cuentas conectadas**, cada persona puede vincular o desvincular Google y GitHub (Cartero no te deja desvincular tu única forma de entrar).

## Si nadie puede entrar

Desde la terminal del servidor:

```bash
# Docker
docker compose exec cartero node dist/scripts/admin.js list
docker compose exec cartero node dist/scripts/admin.js promote  --email tu@ejemplo.com
docker compose exec cartero node dist/scripts/admin.js password --email tu@ejemplo.com

# Desde el código fuente
pnpm --filter @cartero/server admin password --email tu@ejemplo.com
```

`password` pone una contraseña nueva aleatoria (o la que pases con `--password`), la muestra y cierra las sesiones de esa cuenta. `promote` hace admin a una cuenta y la reactiva.
