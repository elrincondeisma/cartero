# Peticiones

## La barra de URL

- **Método**: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- **URL**: admite [variables](03-variables-y-entornos.md) como `{{baseUrl}}/users`. Las variables definidas se resaltan en naranja, las que no existen en rojo. Pasa el ratón por encima para ver su valor.
- **Pegar cURL**: pega un comando `curl …` y se rellenan método, URL, cabeceras, body y autenticación.

## Pestañas del editor

### Params
- **Query params**: tabla sincronizada con la URL. Desmarca una fila para no enviarla sin borrarla.
- **Variables de ruta**: si la URL tiene segmentos como `/users/:id`, aparece una tabla para dar valor a `id`.

### Autorización
Ver [Autenticación](04-autenticacion.md). Por defecto, cada petición **hereda** la de su carpeta o colección.

### Cabeceras
Tabla de cabeceras. Cartero añade solas `User-Agent`, `Accept`, `Host`, `Content-Length` y la de autorización; si escribes una con el mismo nombre, se usa la tuya.

### Body
| Modo | Uso |
|---|---|
| **ninguno** | Sin cuerpo |
| **raw** | Texto libre: JSON, XML, HTML, JavaScript o texto. En JSON tienes **Formatear** |
| **form-data** | Campos de texto y **ficheros** (multipart). Cambia el tipo de la fila a «Fichero» y elige uno |
| **x-www-form-urlencoded** | Formularios clásicos |
| **binario** | Envía un fichero tal cual |
| **GraphQL** | Editor de query y de variables (JSON) |

### Scripts
Código JavaScript que se ejecuta **antes** de enviar (*Pre-request*) o **después** de recibir la respuesta (*Post-response*). Ver [Scripts y tests](05-scripts-y-tests.md).

### Ejemplos
Respuestas guardadas. Sirven para documentar la API y son lo que devuelven los [mock servers](08-mock-servers.md). Para crear uno con una respuesta real, envía la petición y pulsa el icono de guardar del panel de respuesta.

### Descripción
Texto en Markdown que explica la petición. Aparece en la [documentación publicada](10-documentacion-publica.md).

### Ajustes
- Seguir redirecciones (sí por defecto) y mantener el método al redirigir.
- Verificar certificados SSL (no por defecto, para que funcionen los certificados autofirmados de tu red).
- Enviar body en GET, no codificar la URL y no usar el cookie jar.

## La respuesta

- **Estado, tiempo y tamaño**. Pasa el ratón sobre el tiempo para ver el desglose (DNS, TCP, TLS, primer byte, descarga).
- **Body**: *Bonito* (formateado y coloreado), *Raw* y *Vista previa* (HTML, imágenes y PDF). Puedes copiarlo o descargarlo.
- **Cabeceras**, **Cookies** recibidas, **Tests** (resultado de cada `pm.test`), **Consola** (`console.log` de tus scripts) y **Detalles** (tiempos y la petición exacta que se envió, con las variables ya sustituidas).

Arrastra la línea entre el editor y la respuesta para cambiar sus tamaños.

## Código

El botón **</>** genera la petición en más de 20 lenguajes y librerías: cURL, JavaScript (fetch, Axios), Node.js, Python (requests, http.client), Go, Java, C#, PHP, Ruby, Swift, Kotlin, Dart, PowerShell… Con «Sustituir variables» se insertan los valores del entorno activo.

## Historial

Cada petición que envías queda en **Historial**, agrupada por día. Haz clic en una para volver a abrirla tal como la enviaste.

## Guardar y cambios sin guardar

Las pestañas con cambios sin guardar muestran un punto naranja. Si otra persona guarda la misma petición mientras la editas, verás el aviso **«Hay cambios de otra persona»**: puedes cargar su versión o sobrescribirla.
