# Desplegar en AWS

Cartero trae un asistente paso a paso que lo despliega en tu cuenta de AWS con CDK. Al principio solo te pide las credenciales. Después, para cada pieza, eliges si reutilizas lo que ya tienes o dejas que el asistente la cree con sus recomendaciones.

```bash
git clone https://github.com/elrincondeisma/cartero.git && cd cartero
pnpm install
pnpm deploy:aws
```

El asistente habla español o inglés, según el idioma del sistema. Con `pnpm deploy:aws --lang es` lo fuerzas a español.

## Qué necesitas

- Node.js 22 y pnpm.
- Una cuenta de AWS y un usuario o rol que pueda crear los recursos: CloudFormation, roles de IAM, VPC, ECS o EC2, RDS, ElastiCache, Secrets Manager y, sin dominio, CloudFront. La política `AdministratorAccess` lo cubre todo.
- **No** hace falta Docker: AWS descarga directamente la imagen pública de Cartero desde GHCR.

## Los pasos

1. **Credenciales.** Eliges un perfil de `~/.aws` (también los de SSO; si la sesión ha caducado, el asistente ofrece lanzar `aws sso login`) o pegas una access key y su secreto. Las claves pegadas se quedan en memoria y llegan a CDK como variables de entorno del proceso hijo; nunca se escriben en disco.
2. **Región.** Comprueba si CDK está preparado en ella (la pila `CDKToolkit`). Si no lo está, lanza `cdk bootstrap` antes de desplegar.
3. **Modo.** *Recomendado* lo crea todo. *Recurso a recurso* te deja reutilizar una VPC, una base de datos Postgres, un Redis y una imagen concreta.
4. **Cómputo:**
   - **ECS Fargate** (producción): una tarea de 0,5 vCPU y 1 GB detrás de un Application Load Balancer, con los ficheros subidos en EFS.
   - **EC2** (lo más barato): una `t3.small` con Docker Compose y Caddy para el HTTPS automático, una IP elástica y un disco cifrado de 30 GB. Entras con SSM Session Manager; no hay puerto SSH.
5. **Red.**
   - **Nueva (recomendada):** una VPC en dos zonas, con subredes públicas y aisladas y sin NAT, lo que ahorra unos 35 $ al mes. La aplicación tiene IP pública, pero su grupo de seguridad solo acepta tráfico del balanceador (Fargate) o de los puertos 80 y 443 (EC2). RDS y Redis van en las subredes aisladas.
   - **Existente:** el asistente lista tus VPC y separa las subredes en públicas y privadas según sus tablas de rutas. Fargate necesita subredes públicas en dos zonas.
6. **Base de datos.**
   - **RDS Postgres 17 nueva** (`db.t4g.micro`, 20 GB gp3 cifrados, copias de 7 días). Al destruirla deja una snapshot final.
   - **Dentro de la máquina** (solo EC2): un contenedor de Postgres.
   - **Existente:** tus instancias y clústeres de RDS o Aurora Postgres en la VPC elegida. Si RDS gestiona la contraseña en Secrets Manager, se usa ese secreto. Si no, tecleas el usuario y la contraseña y el asistente los guarda en un secreto nuevo. La base de datos tiene que existir; Cartero crea las tablas. El asistente pregunta antes de añadir una regla al grupo de seguridad de la base de datos.
7. **Redis** (para la cola de monitores).
   - **ElastiCache Valkey nuevo** (`cache.t4g.micro`).
   - **Dentro de la máquina** (solo EC2).
   - **Existente:** tus clústeres, grupos de replicación (sin modo clúster) y cachés serverless de la VPC.
8. **Dominio.**
   - **Zona de Route 53:** eliges un nombre como `cartero.midominio.com`. Con Fargate, el asistente busca un certificado de ACM que lo cubra o crea uno validado por DNS. Con EC2, Caddy pide un certificado de Let's Encrypt.
   - **Sin dominio:** con Fargate, CloudFront se pone delante del balanceador y te da `https://xxxx.cloudfront.net`, con WebSocket, y el balanceador solo acepta a CloudFront. Con EC2 tienes `https://<ip>.sslip.io` con Let's Encrypt.
9. **Administración.** El email de quien administra (`ADMIN_EMAILS`) y si cualquiera puede registrarse. Cartero usa la imagen `stable`, que se actualiza desde la app. En el modo *Recurso a recurso* puedes fijar una versión en su lugar (`0.2.0`).
10. **Resumen.** Qué se reutiliza, qué se crea, el coste mensual aproximado y qué se conserva si lo destruyes. No se crea nada hasta que confirmas.

Al terminar, espera a que `/api/health` responda y te enseña la dirección y el enlace al asistente de instalación (`/setup`).

## Coste aproximado

Precios bajo demanda en us-east-1 / eu-west-1, con poco tráfico:

| Montaje | Al mes |
|---|---|
| Fargate + ALB + CloudFront + EFS + RDS + Valkey | ~80 $ |
| Fargate reutilizando tu RDS y tu Redis | ~55 $ |
| EC2 con todo dentro de la máquina | ~22 $ |

## Actualizar, ver el estado y destruir

**Las versiones nuevas de Cartero** se instalan desde el propio Cartero: **Administración → Sistema → Actualizar**, o cada noche si lo activas. En Fargate, Cartero pide a ECS un despliegue nuevo de su propio servicio. En EC2, el contenedor `updater` de la máquina descarga la imagen nueva. Mira [Actualizar Cartero](21-actualizar.md).

Para cambiar el despliegue en sí, vuelve a lanzar `pnpm deploy:aws`. Si hay despliegues en esa cuenta y región, el asistente te ofrece:

- **Actualizar.** Despliega otra vez con la misma configuración y la versión que elijas (`stable` o una fija), y trae la imagen más reciente: en Fargate pide a ECS un despliegue nuevo, y en EC2 reaplica la configuración en la máquina con SSM Run Command, sin reemplazarla. Los despliegues de antes de que hubiera versiones, fijados por digest, pasan a `stable`.
- **Ver el estado.** El stack de CloudFormation, sus salidas y si `/api/health` responde.
- **Destruir.** Escribes el nombre del stack para confirmar. En EC2 con Postgres dentro, ofrece hacer antes una snapshot del disco.

Lo que se **conserva** a propósito al destruir, para no perder datos:

- el secreto `CARTERO_SECRET_KEY` (sin él no se pueden descifrar los secretos guardados en la base de datos);
- la snapshot final de la RDS;
- el sistema de ficheros EFS con los ficheros subidos;
- el secreto con la contraseña de Postgres (EC2 con Postgres dentro);
- todo lo que ya existía: nunca se borra.

Para borrarlo, busca los recursos con la etiqueta `cartero:stack=<nombre>`.

## Sin preguntas (CI)

El asistente guarda cada despliegue, sin secretos, en `~/.config/cartero-aws/cartero-aws.<stack>.json` (`CARTERO_AWS_HOME` cambia la carpeta). Con ese fichero puedes desplegar, comprobar o destruir sin el asistente, con las credenciales del entorno o `--profile`:

```bash
node deploy/aws/dist/cli.js deploy  --config cartero-aws.Cartero.json
node deploy/aws/dist/cli.js status  --config cartero-aws.Cartero.json
node deploy/aws/dist/cli.js destroy --config cartero-aws.Cartero.json --yes
```

## Conviene saber

- **Una sola instancia.** Cartero guarda en memoria la presencia y el progreso en vivo del runner, así que corre en una tarea o una máquina. Las migraciones se lanzan al arrancar.
- **Los secretos nunca van en claro.** Las contraseñas viven en Secrets Manager. En Fargate, la tarea compone `DATABASE_URL` y `REDIS_URL` al arrancar. En EC2, `/opt/cartero/apply.sh` las lee con el rol de la instancia.
- **Logs.** En Fargate van a CloudWatch (`aws logs tail <grupo> --follow`). En EC2, usa `docker compose logs` en `/opt/cartero` (`aws ssm start-session --target <instancia>`).
- **GuardDuty.** Si tu cuenta tiene GuardDuty Runtime Monitoring, GuardDuty añade su agente a la tarea de Fargate y crea su propio endpoint en la VPC. El rol de la tarea puede descargar el agente de ECR. Al destruir, el asistente quita primero ese endpoint, solo en la VPC que creó él, para que la VPC se pueda borrar.
- Para cambiar el stack, mira [`deploy/aws`](../../../deploy/aws/README.es.md).
