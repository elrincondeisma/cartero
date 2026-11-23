> 🌐 [English](../06-collections-and-import.md) · **Español**

# Colecciones e importación

## Colecciones y carpetas

Una **colección** agrupa peticiones, y puede tener carpetas anidadas. Cada colección y cada carpeta tienen su propia configuración (doble clic en una carpeta, o menú ··· → *Configuración*):

- **Resumen**: descripción en Markdown (aparece en la documentación publicada) y la lista de peticiones.
- **Autorización**: la heredan las peticiones que contiene.
- **Scripts**: se ejecutan para cada petición que contiene.
- **Variables**: de colección o de carpeta.
- **Documentación** (solo colecciones): ver [Documentación pública](10-documentacion-publica.md).
- **Actividad**: historial de cambios y comentarios.

En el árbol:
- **Arrastra** peticiones y carpetas para reordenarlas o moverlas a otra carpeta (la línea naranja indica dónde caerá; sobre una carpeta, dentro).
- Menú **···**: nueva petición o carpeta, ejecutar, renombrar, duplicar, fork, exportar y eliminar.
- **Filtrar peticiones**: busca por nombre o URL.

## Importar

Pulsa el icono de importar en la barra lateral de Colecciones (o Ctrl+K → *Importar*). Hay tres formas: **ficheros** (arrastrar o elegir), **pegar texto** o **URL**. El formato se detecta solo.

| Formato | Qué se importa |
|---|---|
| **Postman** colección v1, v2.0 y v2.1 | Todo: carpetas, peticiones, auth, scripts, variables, ejemplos y descripciones |
| **Postman** entorno y globales | Variables (las secretas siguen siendo secretas) |
| **Postman** ZIP de exportación de datos | Todas las colecciones y entornos de tu cuenta de una vez |
| **Insomnia** v4 (JSON) y v5 (YAML) | Carpetas, peticiones, auth, scripts; el entorno base pasa a variables de colección y los sub-entornos a entornos |
| **OpenAPI** 3.0/3.1 y **Swagger** 2.0 (JSON o YAML) | Una petición por operación, agrupadas por *tags*, con ejemplos |
| **cURL** | Una petición |
| Exportación de workspace de Cartero | Todo el workspace |

## Migrar desde Postman, paso a paso

Lo más rápido es **conectar tu cuenta de Postman**: Cartero lee tus workspaces con la API de Postman, sin exportar nada.

1. En Postman, abre [tus API keys](https://go.postman.co/settings/me/api-keys), pulsa **Generate API Key** y cópiala.
2. En Cartero: **Importar → Conectar con tu cuenta de Postman** y pega la key.
3. Marca los workspaces que quieras. En cada uno puedes desmarcar colecciones o entornos, traer o no las variables globales y elegir dónde se guarda: en un **workspace nuevo** con el mismo nombre o en uno que ya tengas.
4. Pulsa **Importar** y sigue el progreso. Al acabar verás lo que se ha creado, lo que se ha actualizado y lo que haya fallado (si falla un elemento, el resto sigue).

Conviene saber:

- **Volver a importar actualiza en lugar de duplicar.** Cartero recuerda qué vino de Postman: la próxima vez, esas colecciones y entornos se sustituyen en su sitio (con el mismo id, así que monitores, mocks y enlaces siguen funcionando) y aparecen marcados con *se actualiza* antes de empezar.
- **Tu key no se guarda.** Solo se usa durante la importación y se olvida al cerrar la ventana. Puedes borrarla en Postman cuando acabes.
- **No todo sale de Postman.** Los valores *actuales* de las variables y los secretos del Vault nunca llegan a la nube de Postman, así que solo llegan los valores iniciales; las variables secretas que lleguen vacías se señalan para que las rellenes. Los mocks, monitores y especificaciones de API no se importan: créalos en Cartero a partir de las colecciones.
- Cada importación gasta unas pocas llamadas de tu cupo de la API de Postman (el asistente te lo muestra): una por colección y por entorno, más alguna para listar los workspaces.

**Sin API key:** en Postman ve a **Settings → Data → Export data**, marca colecciones y entornos y arrastra a **Importar → Ficheros** el ZIP que te llega por email. O exporta cada colección por separado (··· → *Export* → *Collection v2.1*) e impórtala.

## Exportar

- Una colección: menú ··· → **Exportar (Postman v2.1)**. El fichero se puede importar en Postman y en cualquier herramienta compatible. La ida y vuelta es **sin pérdidas**.
- Un entorno: en la sección Entornos, menú ··· → **Exportar**.
- Todo el workspace (copia de seguridad): **Ajustes → Workspace → Exportar workspace**.

## Fork y merge

- **Fork**: copia una colección (a este u otro workspace) para hacer cambios sin afectar a la original.
- **Merge en el origen**: menú ··· del fork. La colección original queda igual que el fork. Se guarda una revisión, así que se puede deshacer desde el historial de cambios.
