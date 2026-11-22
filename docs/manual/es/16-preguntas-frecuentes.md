> 🌐 [English](../16-faq.md) · **Español**

# Preguntas frecuentes

## Instalación y administración

**He abierto Cartero por primera vez y veo un asistente en lugar del login.**
Es lo normal: una instancia nueva te pide crear la cuenta de administrador y elegir los ajustes básicos. Lo tienes en [Primer arranque](15-autoalojamiento.md#primer-arranque-el-asistente).

**¿Dónde cambio lo que elegí en el asistente?**
En **Administración** (menú de la cuenta → Administración). Están todos los ajustes, y desde la pestaña **Sistema** puedes volver a abrir el asistente.

**¿Tengo que seguir tocando el `.env`?**
Solo para lo que el servidor necesita antes de arrancar: `CARTERO_SECRET_KEY`, la base de datos y Redis. Todo lo demás (URL pública, registro, Google y GitHub, email, seguridad) se ajusta en Administración. Mira [Variables de entorno](15-autoalojamiento.md#variables-de-entorno).

**Administración dice que uso la clave de cifrado de desarrollo.**
Pon en el `.env` una `CARTERO_SECRET_KEY` larga y aleatoria (`openssl rand -base64 32`) y reinicia. Hazlo antes de guardar secretos de verdad: lo cifrado con la clave anterior no se puede leer con la nueva.

**He perdido la contraseña del admin, o no hay ningún admin.**
Usa los comandos de rescate desde la terminal del servidor: [Si nadie puede entrar](17-administracion-y-login-social.md#si-nadie-puede-entrar).

**«Continuar con Google» dice que la URL de redirección no coincide.**
La URL de callback registrada en Google o GitHub tiene que ser exactamente la que muestra **Administración → Inicio de sesión**. Si cambiaste la URL pública, actualízala también allí.

**Falla el email de prueba.**
Cartero muestra la respuesta del servidor de correo. Lo más habitual: el puerto (el 465 va con `smtps://`, el 587 con `smtp://`), una contraseña con caracteres especiales que hay que codificar en la URL, o un proveedor que pide una contraseña de aplicación.

**¿Por qué hay gente que no puede registrarse?**
Mira **Administración → Inicio de sesión**: el registro puede estar cerrado o limitado a algunos dominios de email. Las invitaciones funcionan siempre.

## Uso


**¿Mis scripts de Postman funcionarán?**
Sí. Cartero usa el mismo motor de ejecución que Postman (`postman-runtime`), con la API `pm.*` completa y las mismas librerías disponibles con `require`.

**¿Por qué las peticiones salen desde el servidor y no desde mi navegador?**
Así no hay problemas de CORS, funcionan cookies, certificados autofirmados y todas las autenticaciones, y puedes llamar a APIs de la red donde está el servidor (por ejemplo, tu red local). Si tu instancia es pública, un admin puede bloquear las redes privadas en **Administración → Seguridad**.

**¿Puedo probar una API que solo está en mi ordenador (localhost)?**
Solo si Cartero se ejecuta en ese mismo ordenador o en la misma red. Para una API en tu portátil y un Cartero en un servidor, expón la API en la red (o en tu Tailscale) y usa esa dirección.

**¿Hay límites de ejecuciones, mocks o monitores?**
No. El único límite es la capacidad de tu servidor.

**¿Dónde se guardan mis datos?**
En la base de datos PostgreSQL de tu servidor. Las variables secretas, cifradas con AES-256-GCM.

**Me sale «Hay cambios de otra persona». ¿Qué hago?**
Otra persona ha guardado la misma petición mientras la editabas. Pulsa el aviso para cargar su versión (perderás tus cambios sin guardar), o guarda y elige **Sobrescribir** para quedarte con la tuya. Si te equivocas, puedes restaurar cualquier versión desde **Cambios**.

**Un test falla con «pm.response is undefined».**
Estás usando `pm.response` en el script *Pre-request*: la respuesta solo existe en *Post-response*.

**¿Cómo veo qué se envió exactamente, con las variables sustituidas?**
En la respuesta, pestaña **Detalles**.

**¿Puedo deshacer algo que borré?**
Sí: panel de comentarios y cambios de la petición, o **Actividad** de la colección → **Restaurar**.

**¿Cómo quito los datos de ejemplo?**
**Ajustes → Workspace → Datos de ejemplo → Quitar datos de ejemplo**.

**¿Cómo cambio el idioma?**
Desde el menú de tu cuenta (arriba a la derecha) o en **Ajustes → Mi perfil → Idioma de la interfaz**.

**¿Es seguro conectar un asistente de IA?**
Usa un token propio que puedes revocar, actúa con tus permisos, no puede borrar nada y nunca ve los secretos. Ver [Conectar asistentes de IA](13-ia-mcp.md).
