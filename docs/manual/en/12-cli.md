# CLI: cartero run

The CLI runs collections from the terminal or your continuous integration (GitHub Actions, GitLab CI, Jenkins…). It's the equivalent of *Newman*.

## Run a file

```bash
cartero run collection.postman_collection.json \
  -e production.postman_environment.json \
  -d data.csv \
  -r cli,junit,html
```

It accepts Postman, Insomnia, OpenAPI and cURL collections, as well as ZIP files or a URL.

## Run a collection from your server

```bash
export CARTERO_SERVER=https://cartero.example.com
export CARTERO_TOKEN=crt_…          # Settings → API tokens
export CARTERO_WORKSPACE=<id>

cartero run <collection-id> -e <environment-id> --report
```

With `--report`, the result shows up in Cartero's **Runs** section.

## Options

| Option | Description |
|---|---|
| `-e, --environment` | Environment (file or id) |
| `-g, --globals` | Globals file |
| `-d, --iteration-data` | CSV or JSON with iteration data |
| `-n, --iteration-count` | Number of iterations |
| `--folder` | Run only one folder or request (name or id) |
| `--env-var key=value` | Override a variable (repeatable) |
| `--delay-request`, `--timeout-request` | Pause and timeout per request (ms) |
| `--bail` | Stop on first failure |
| `--strict-ssl` | Verify certificates |
| `-r, --reporters` | `cli`, `json`, `junit`, `html` |
| `--reporter-junit-export`, `--reporter-html-export`, `--reporter-json-export` | Report paths |
| `--silent` | No console output |

Exit codes: **0** if everything passes, **1** if any test or request fails, **2** on usage errors.

## GitHub Actions

```yaml
- name: API tests
  run: npx @cartero/cli run ${{ vars.COLLECTION_ID }} -e ${{ vars.ENVIRONMENT_ID }} -r cli,junit --report
  env:
    CARTERO_SERVER: https://cartero.example.com
    CARTERO_TOKEN: ${{ secrets.CARTERO_TOKEN }}
    CARTERO_WORKSPACE: ${{ vars.CARTERO_WORKSPACE }}
```

> Until the package is published on npm, use the CLI from the repository: `node packages/cli/dist/index.js run …`.
