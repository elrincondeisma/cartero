# CLI: cartero run

La CLI ejecuta colecciones desde la terminal o desde tu integración continua (GitHub Actions, GitLab CI, Jenkins…). Equivale a *Newman*.

## Ejecutar un fichero

```bash
cartero run coleccion.postman_collection.json \
  -e produccion.postman_environment.json \
  -d datos.csv \
  -r cli,junit,html
```

Acepta colecciones de Postman, Insomnia, OpenAPI y cURL, y también ficheros ZIP o una URL.

## Ejecutar una colección de tu servidor

```bash
export CARTERO_SERVER=https://cartero.ejemplo.com
export CARTERO_TOKEN=crt_…          # Ajustes → Tokens de API
export CARTERO_WORKSPACE=<id>

cartero run <id-de-colección> -e <id-de-entorno> --report
```

Con `--report`, el resultado aparece en la sección **Ejecuciones** de Cartero.

## Opciones

| Opción | Descripción |
|---|---|
| `-e, --environment` | Entorno (fichero o id) |
| `-g, --globals` | Fichero de globales |
| `-d, --iteration-data` | CSV o JSON con datos para iterar |
| `-n, --iteration-count` | Número de iteraciones |
| `--folder` | Ejecutar solo una carpeta o petición (nombre o id) |
| `--env-var clave=valor` | Sobrescribe una variable (repetible) |
| `--delay-request`, `--timeout-request` | Pausa y tiempo máximo por petición (ms) |
| `--bail` | Parar al primer fallo |
| `--strict-ssl` | Verificar certificados |
| `-r, --reporters` | `cli`, `json`, `junit`, `html` |
| `--reporter-junit-export`, `--reporter-html-export`, `--reporter-json-export` | Rutas de los informes |
| `--silent` | Sin salida por consola |

Códigos de salida: **0** si todo pasa, **1** si falla algún test o petición, **2** si hay un error de uso.

## GitHub Actions

```yaml
- name: Tests de la API
  run: npx @cartero/cli run ${{ vars.COLECCION_ID }} -e ${{ vars.ENTORNO_ID }} -r cli,junit --report
  env:
    CARTERO_SERVER: https://cartero.ejemplo.com
    CARTERO_TOKEN: ${{ secrets.CARTERO_TOKEN }}
    CARTERO_WORKSPACE: ${{ vars.CARTERO_WORKSPACE }}
```

> Mientras el paquete no esté publicado en npm, usa la CLI desde el repositorio: `node packages/cli/dist/index.js run …`.
