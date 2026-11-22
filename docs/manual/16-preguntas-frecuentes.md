# Preguntas frecuentes

**¿Mis scripts de Postman funcionarán?**
Sí. Cartero usa el mismo motor de ejecución que Postman (`postman-runtime`), con la API `pm.*` completa y las mismas librerías disponibles con `require`.

**¿Por qué las peticiones salen desde el servidor y no desde mi navegador?**
Así no hay problemas de CORS, funcionan cookies, certificados autofirmados y todas las autenticaciones, y puedes llamar a APIs de la red donde está el servidor (por ejemplo, tu red local). Si tu instancia es pública, el administrador puede bloquear las redes privadas con `BLOCK_PRIVATE_NETWORKS=true`.

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
