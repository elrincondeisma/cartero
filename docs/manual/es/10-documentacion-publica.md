> 🌐 [English](../10-public-docs.md) · **Español**

# Documentación pública

Convierte una colección en una página de documentación que puedes compartir con cualquiera, aunque no tenga cuenta.

## Publicar

1. Abre la configuración de la colección → **Documentación**.
2. Elige la **URL** (`/docs/mi-api`).
3. Opcional: un **entorno** para mostrar los valores reales de las variables (por ejemplo, la URL base de producción).
4. Opcional: **protegerla con contraseña**.
5. Pulsa **Publicar**.

## Qué incluye

- La descripción de la colección y de cada carpeta y petición (en Markdown).
- Por cada petición: método, URL, query params, cabeceras, body, un **ejemplo cURL** listo para copiar y las **respuestas de ejemplo** guardadas.
- Un índice lateral navegable, en tema claro u oscuro.

## Seguridad

Nunca se publican:
- los valores de las variables **secretas**;
- las contraseñas, tokens y claves escritos directamente en la autenticación (se muestran como `••••••`).

Las variables normales del entorno elegido sí se muestran. Para retirarla, pulsa **Retirar** o desmarca **Publicada**.

> Escribe buenas descripciones: usa títulos, listas, tablas y bloques de código en Markdown en la pestaña *Resumen* de la colección y en el campo de descripción de cada petición.
