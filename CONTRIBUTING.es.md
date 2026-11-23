> 🌐 [English](CONTRIBUTING.md) · **Español**

# Contribuir a Cartero

¡Gracias por tu interés! Algunas pautas para que tu PR entre rápido.

## Preparar el entorno

```bash
pnpm install
pnpm db:up
pnpm --filter "./packages/*" build
pnpm --filter @cartero/server dev
pnpm --filter @cartero/web dev
```

## Antes de abrir un PR

- `pnpm typecheck` y `pnpm test` en verde.
- Si tocas la interfaz, pasa el E2E: `npx playwright test`. Compila la web y levanta dos instancias aisladas con sus propias bases de datos (una ya instalada y otra vacía para probar el asistente de instalación), así que nunca toca tus datos de desarrollo. Necesita el Postgres y el Redis de `pnpm db:up` en marcha.
- Si tocas importadores o exportadores, añade un fixture en `packages/importers/fixtures` y su test. La regla es la **ida y vuelta sin pérdidas**: importar y volver a exportar una colección de Postman debe dar el mismo JSON.
- Si tocas la API, añade el caso a `apps/server/src/server.test.ts` (o a `admin.test.ts` / `setup.test.ts` si es de administración o instalación).
- Los ajustes nuevos de la instancia van en `apps/server/src/lib/settings.ts` y tienen que poder editarse en **Administración** (formularios compartidos en `apps/web/src/features/admin/forms.tsx`, que también usa el asistente de instalación). Las variables de entorno quedan para lo que el servidor necesita antes de arrancar, o como valor inicial.
- Si cambias el esquema de la base de datos, genera la migración con `pnpm --filter @cartero/server db:generate` y súbela con el PR.

## Idiomas (español e inglés)

- Todo texto visible va en `t('Texto en español')` (o `tj()` si lleva elementos dentro, como `<code>`). La traducción va en `apps/web/src/i18n/en.ts`, con el texto español como clave.
- `pnpm i18n:extract` envuelve en `t()` los textos nuevos que se te escapen, y `pnpm i18n:check` falla si falta alguna traducción (también corre en la CI).
- El manual vive en `docs/manual/` (inglés, el idioma principal del repositorio) y `docs/manual/es/` (español). Cada capítulo lleva el mismo número en los dos idiomas y enlaza arriba a su traducción. Los mismos ficheros se publican en [cartero.elrincondeisma.com/es/docs](https://cartero.elrincondeisma.com/es/docs/) (la landing los compila con Starlight); un capítulo nuevo tiene que añadirse a un grupo en `apps/landing/scripts/docs-groups.mjs`.
- Los README y CONTRIBUTING van en inglés, con su versión en español en `*.es.md`. Si cambias uno, actualiza el otro.

## Convenciones

- TypeScript estricto. Formato con Biome: `pnpm format`.
- Textos de la interfaz claros y sin jerga, siempre en los dos idiomas.
- El modelo interno es Postman Collection v2.1. No inventes campos nuevos si existe uno equivalente en el formato de Postman.
- Toda ruta de la API comprueba el rol en el workspace (`assertRole` / `assertCollection`).

## Publicar una versión

Las instalaciones se actualizan a versiones publicadas (la imagen `stable`), nunca a lo que haya en `main`.

1. Sube la versión en `package.json` y `apps/server/package.json` (tienen que coincidir) y haz commit.
2. Crea y sube el tag: `git tag v0.3.0 && git push origin v0.3.0`.
3. El workflow `Release` pasa los tests, publica las imágenes `0.3.0`, `0.3` y `stable`, y crea la GitHub Release con las notas. A partir de ahí, las instalaciones ven la versión nueva en **Administración → Sistema**.

Las migraciones tienen que ser **compatibles hacia atrás** con la versión anterior: añade columnas y tablas, no las renombres ni las borres en la misma versión. Si una actualización falla en Fargate, ECS vuelve a la versión anterior, que correrá sobre el esquema nuevo.

## Reportar fallos de seguridad

No abras una issue pública: escribe a los mantenedores en privado.
