> 🌐 [English](../21-updating.md) · **Español**

# Actualizar Cartero

Cada versión nueva de Cartero se publica con un número (`v0.2.0`, `v0.2.1`…), notas de la versión y una imagen de Docker. Las instalaciones usan la imagen `stable`, que siempre apunta a la última versión publicada. Puedes actualizar desde el propio Cartero.

## Desde Administración

En **Administración → Sistema → Actualizaciones** ves la versión instalada, la última publicada (con un enlace a sus notas) y el botón **Actualizar a X.Y.Z**. Cuando hay una versión nueva, quien administra ve además un aviso junto a su avatar.

El botón descarga otra vez la imagen `stable` y reinicia Cartero. Tarda desde unos segundos (Docker Compose) hasta unos minutos (AWS Fargate), y la página se recarga sola cuando responde la versión nueva. Las migraciones de la base de datos se aplican al arrancar.

En la misma tarjeta hay dos interruptores:

- **Buscar versiones nuevas.** Cartero pide a GitHub la lista de versiones cada seis horas. Apágalo si tu servidor no tiene salida a Internet o prefieres que no lo haga.
- **Actualizar sola cada noche.** Si hay versión nueva, Cartero se actualiza entre las 03:00 y las 05:00 UTC. Viene apagado.

## Quién reinicia Cartero

Cartero no puede reiniciarse a sí mismo, así que el botón pide el reinicio a quien lo ejecuta. La petición no lleva parámetros: solo puede significar «vuelve a descargar `stable`».

| Dónde corre | Quién lo reinicia |
|---|---|
| Docker Compose (el `docker-compose.yml` del repositorio) | El contenedor `updater`: descarga `stable` y recrea solo el servicio `cartero`. |
| AWS EC2 (el asistente de AWS) | El mismo contenedor `updater`, junto a Cartero en la máquina. |
| AWS Fargate (el asistente de AWS) | ECS: Cartero pide un despliegue nuevo de su propio servicio. Su rol solo puede hacerlo en el clúster del stack. |

**El contenedor `updater`** usa la imagen oficial `docker:cli` y el script de [`docker/updater.sh`](../../../docker/updater.sh). No tiene puertos. Se comunica con Cartero a través de una carpeta compartida, y cada 10 segundos mira si hay una petición. Necesita el socket de Docker, que **equivale a acceso root en la máquina**. Si no lo quieres, borra el servicio `updater` de `docker-compose.yml`: Cartero te seguirá avisando de las versiones nuevas, y actualizas a mano:

```bash
docker compose pull
docker compose up -d
```

## Fijar una versión

Para quedarte en una versión concreta y actualizar cuando tú decidas:

- **Docker Compose:** pon `CARTERO_VERSION=0.2.0` en `.env` y lanza `docker compose up -d`. En lugar del botón, Cartero muestra «la versión está fijada». Para volver a las actualizaciones automáticas, quita la línea.
- **AWS:** en el modo *Recurso a recurso*, el asistente pregunta la versión (`stable` o `X.Y.Z`). Para cambiarla, vuelve a lanzar `pnpm deploy:aws` y elige **Actualizar**.

## Si una actualización falla

- **Fargate:** ECS arranca la versión nueva junto a la antigua, y solo le pasa el tráfico cuando responde en `/api/health`. Si falla, el circuit breaker vuelve solo a la versión anterior.
- **Docker Compose y EC2:** si la imagen no se puede descargar, no cambia nada. Si la versión nueva no arranca, `docker compose logs cartero` te dice por qué.

En los dos casos, Administración muestra el error. Antes de actualizar una instalación importante, haz una copia de seguridad (mira [Copias de seguridad](15-autoalojamiento.md#copias-de-seguridad)).

## Construir desde el código

Si construyes tú la imagen, Cartero es una versión de desarrollo: te avisa de las versiones nuevas, pero no se actualiza sola.

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```
