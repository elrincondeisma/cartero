# @cartero/deploy-aws

Un asistente que despliega Cartero en AWS con CDK. Cómo usarlo está en el manual: [Desplegar en AWS](../../docs/manual/es/20-desplegar-en-aws.md). Esta página es para quien quiera cambiarlo.

[English](README.md)

```
src/cli.ts            entrada: asistente, o deploy/status/destroy con --config
src/i18n.ts           textos en español e inglés (mismas claves; lo comprueba un test)
src/wizard/           los pasos: credenciales y región, build (cómputo, red, base de datos,
                      Redis, dominio, administración), resumen, manage (actualizar, estado, destruir)
src/aws/              session (perfiles, claves, entorno para cdk) y discover (consultas de solo lectura)
src/config.ts         DeployConfig: lo que decide el asistente; se guarda sin secretos
src/cost.ts           coste mensual aproximado
src/deploy.ts         lanza el CLI de cdk del paquete, espera a /api/health, SSM, snapshots
src/app.ts            app de CDK: lee el DeployConfig (-c config=… o CARTERO_AWS_CONFIG)
src/stack/            CarteroStack (Fargate o EC2) y los ficheros que escribe la EC2
test/                 plantillas de las cuatro combinaciones y lógica del asistente
```

## Trabajar en él

```bash
pnpm --filter @cartero/deploy-aws test        # vitest: plantillas + lógica del asistente
pnpm --filter @cartero/deploy-aws typecheck
pnpm --filter @cartero/deploy-aws build
cd deploy/aws && npx cdk synth -c config=/ruta/a/cartero-aws.<stack>.json
```

`cdk synth` no necesita credenciales cuando la configuración lo trae todo (el asistente guarda las zonas de una VPC nueva y lo existente se importa por ID), así que el stack nunca depende de búsquedas de contexto.

## Reglas que sigue el stack

- **Ningún secreto en la plantilla ni en el fichero de configuración.** Fargate recibe `DB_USER`, `DB_PASS` y `REDIS_PASS` de Secrets Manager y compone las URL al arrancar la tarea (`TASK_BOOTSTRAP`). La EC2 los lee con su rol en `apply.sh`. Los tests lo comprueban.
- **Una sola instancia.** La presencia y el progreso en vivo del runner están en memoria: `desiredCount: 1` y, en EC2, una sola máquina.
- **No se borra nada que ya existía.** Lo existente se importa por atributos. Las reglas añadidas a sus grupos de seguridad desaparecen con el stack.
- **Los datos sobreviven a `destroy`.** Se conservan `CARTERO_SECRET_KEY`, la snapshot de RDS, EFS y la contraseña de la base de datos en contenedor.
- **El user data de la EC2 no cambia entre despliegues**, así que la máquina nunca se reemplaza. La configuración vive en el parámetro de SSM `/cartero/<stack>/config`, y `apply.sh` la aplica al arrancar y al actualizar.
- **La imagen es `:stable` y se actualiza desde la app.** En Fargate, el rol de la tarea solo puede `ecs:DescribeTasks`, `ecs:DescribeServices` y `ecs:UpdateService` sobre el clúster del stack, para redesplegar su propio servicio. En EC2, el contenedor `updater` (el mismo [`docker/updater.sh`](../../docker/updater.sh) que en Docker Compose) recrea Cartero. Con una versión fija (`:0.2.0`) no hay ni permisos ni botón. Lo comprueban los tests.
