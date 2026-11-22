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
- Si tocas la interfaz, pasa el E2E: `npx playwright test`.
- Si tocas importadores o exportadores, añade un fixture en `packages/importers/fixtures` y su test. La regla es la **ida y vuelta sin pérdidas**: importar y volver a exportar una colección de Postman debe dar el mismo JSON.
- Si tocas la API, añade el caso a `apps/server/src/server.test.ts`.
- Si cambias el esquema de la base de datos, genera la migración con `pnpm --filter @cartero/server db:generate` y súbela con el PR.

## Convenciones

- TypeScript estricto. Formato con Biome: `pnpm format`.
- Textos de la interfaz en español, claros y sin jerga.
- El modelo interno es Postman Collection v2.1. No inventes campos nuevos si existe uno equivalente en el formato de Postman.
- Toda ruta de la API comprueba el rol en el workspace (`assertRole` / `assertCollection`).

## Reportar fallos de seguridad

No abras una issue pública: escribe a los mantenedores en privado.
