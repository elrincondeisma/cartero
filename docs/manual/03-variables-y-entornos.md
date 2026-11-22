# Variables y entornos

Las variables evitan repetir valores (URLs base, tokens, ids) y permiten cambiar de entorno sin tocar las peticiones. Se escriben entre llaves dobles: `{{baseUrl}}`.

## Ámbitos y prioridad

De menor a mayor prioridad (si dos se llaman igual, gana la de más abajo):

1. **Globales**: para todo el workspace. Entornos → Globales.
2. **De colección**: en la configuración de la colección → Variables.
3. **De carpeta**: en la configuración de la carpeta → Variables.
4. **De entorno**: las del entorno activo.
5. **De datos**: las columnas del fichero CSV/JSON en el [runner](07-runner.md).
6. **Locales**: las que crea un script con `pm.variables.set()` y solo duran esa ejecución.

## Entornos

Un entorno es un conjunto de variables con nombre: *Local*, *Staging*, *Producción*…

- Créalo en **Entornos → +**.
- Actívalo con el selector de la barra superior, con la ✓ de la lista o con Ctrl+K.
- El icono 👁 junto al selector muestra las variables activas sin salir de lo que estás haciendo.

## Variables secretas

Marca una variable como **Secreto** para:
- ocultar su valor en pantalla (salvo que actives «Mostrar secretos»);
- guardarla **cifrada** en la base de datos (AES-256-GCM);
- que no aparezca nunca en la documentación publicada ni se muestre a los asistentes de IA.

## Variables desde scripts

```js
pm.environment.set('token', pm.response.json().token)  // se guarda en el entorno
pm.collectionVariables.set('userId', 42)               // se guarda en la colección
pm.globals.set('ultimaPrueba', Date.now())             // se guarda en globales
pm.variables.set('temporal', 'x')                      // solo durante esta ejecución
```

Los cambios que hacen los scripts en entornos, colección y globales **se guardan automáticamente** (si tienes permiso de edición), igual que en Postman.

## Variables dinámicas

Generan un valor nuevo en cada envío: `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`, `{{$randomFirstName}}`, `{{$randomFullName}}`, `{{$randomCity}}`, `{{$randomCompanyName}}`, `{{$randomLoremSentence}}`, `{{$randomUUID}}`, `{{$randomBoolean}}`, `{{$randomPrice}}`… (las mismas que Postman).
