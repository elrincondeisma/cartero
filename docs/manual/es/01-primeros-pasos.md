> 🌐 [English](../01-getting-started.md) · **Español**

# Primeros pasos

Cartero es un cliente de APIs: preparas peticiones HTTP, las envías, ves la respuesta y automatizas pruebas. Funciona en el navegador y los datos viven en tu propio servidor.

## Crear tu cuenta

1. Abre la dirección de tu Cartero y pulsa **Regístrate**.
2. Escribe tu nombre, email y una contraseña de al menos 8 caracteres.
3. Al entrar se crea tu **workspace personal**, solo tuyo.

La primera vez verás un asistente con tres opciones:

- **Importar desde Postman**: trae tus colecciones y entornos (ver [Colecciones e importación](06-colecciones-e-importacion.md)).
- **Ver un ejemplo completo**: crea un workspace «Demo Cartero» con APIs públicas reales, tests, entornos, un mock, monitores y documentación. Se quita con un clic en **Ajustes → Workspace → Datos de ejemplo**.
- **Empezar en blanco**.

Después te ofrece un **recorrido guiado** por la interfaz. Puedes repetirlo cuando quieras desde el botón de ayuda **(?)**.

## Idioma

Cartero está en **español** e **inglés**. Cámbialo desde el menú de tu cuenta (arriba a la derecha), en **Ajustes → Mi perfil** o con los enlaces bajo el formulario de inicio de sesión. La elección se guarda en tu cuenta.

## La pantalla

| Zona | Para qué sirve |
|---|---|
| **Barra superior** | Cambiar de workspace, buscar (Ctrl+K), ayuda, elegir el entorno activo y ver sus variables (👁), tema claro/oscuro y tu cuenta |
| **Raíl izquierdo** | Secciones: Colecciones, Entornos, Historial, Ejecuciones, Mock servers, Monitores y Ajustes |
| **Barra lateral** | El contenido de la sección: el árbol de colecciones, la lista de entornos o el historial |
| **Pestañas** | Peticiones, carpetas, colecciones, entornos y ejecuciones abiertas |

## Tu primera petición

1. Pulsa **+** en la barra de pestañas (o **Ctrl+T**).
2. Escribe una URL, por ejemplo `https://jsonplaceholder.typicode.com/posts/1`.
3. Pulsa **Enviar** (o **Ctrl+Enter**).
4. Abajo verás el código de estado, el tiempo, el tamaño y el cuerpo formateado.
5. Pulsa **Guardar** (Ctrl+S), ponle nombre y elige una colección.

> **Consejo:** si tienes un comando `curl` (de la documentación de una API o de las herramientas del navegador), pégalo directamente en la barra de URL y Cartero lo convierte en una petición.

## Buscarlo todo: Ctrl+K

La paleta de comandos encuentra peticiones por nombre o URL, activa entornos, abre secciones y lanza acciones (importar, nueva petición, tema, manual…). Escribe varias palabras para afinar: `post crear`.
