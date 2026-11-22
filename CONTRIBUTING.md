> 🌐 **English** · [Español](CONTRIBUTING.es.md)

# Contributing to Cartero

Thanks for your interest! A few guidelines to get your PR merged quickly.

## Set up your environment

```bash
pnpm install
pnpm db:up
pnpm --filter "./packages/*" build
pnpm --filter @cartero/server dev
pnpm --filter @cartero/web dev
```

## Before opening a PR

- `pnpm typecheck` and `pnpm test` pass.
- If you touch the UI, run the E2E suite: `npx playwright test`. It builds the web app and starts two isolated instances with their own databases (one already set up, one empty to test the setup wizard), so it never touches your development data. Postgres and Redis from `pnpm db:up` must be running.
- If you touch importers or exporters, add a fixture in `packages/importers/fixtures` and its test. The rule is a **lossless round trip**: importing a Postman collection and exporting it again must produce the same JSON.
- If you touch the API, add the case to `apps/server/src/server.test.ts` (or `admin.test.ts` / `setup.test.ts` for administration and setup).
- New instance settings go in `apps/server/src/lib/settings.ts` and must be editable in **Administration** (shared forms in `apps/web/src/features/admin/forms.tsx`, also used by the setup wizard). Environment variables are only for what the server needs before it starts, or as initial values.
- If you change the database schema, generate the migration with `pnpm --filter @cartero/server db:generate` and include it in the PR.

## Languages (English and Spanish)

- Every visible string goes through `t('Texto en español')` (or `tj()` if it contains elements such as `<code>`). The Spanish text is the key; the English translation goes in `apps/web/src/i18n/en.ts`.
- `pnpm i18n:extract` wraps any new strings you missed in `t()`, and `pnpm i18n:check` fails if a translation is missing (it also runs in CI).
- The user guide lives in `docs/manual/` (English, the repository's main language) and `docs/manual/es/` (Spanish). Each chapter has the same number in both languages and links to its translation at the top.
- READMEs and CONTRIBUTING are in English, with a Spanish version in `*.es.md`. If you change one, update the other.

## Conventions

- Strict TypeScript. Format with Biome: `pnpm format`.
- UI copy should be clear and jargon-free, always in both languages.
- The internal model is Postman Collection v2.1. Don't invent new fields if Postman's format already has an equivalent.
- Every API route checks the role in the workspace (`assertRole` / `assertCollection`).

## Reporting security issues

Don't open a public issue: contact the maintainers privately.
