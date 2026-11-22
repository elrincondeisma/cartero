> 🌐 [English](../09-monitors.md) · **Español**

# Monitores

Un monitor ejecuta una colección **periódicamente** y te avisa si algo falla. Sirve para vigilar que tu API (o las de terceros de las que dependes) siguen funcionando.

## Crear un monitor

**Monitores → Nuevo**:

- **Colección** y **entorno**.
- **Frecuencia**: cada 5 o 15 minutos, cada hora, cada día o un **cron** personalizado (`minuto hora día mes día-semana`, por ejemplo `0 9 * * 1-5` = laborables a las 9:00).
- **Zona horaria**.
- **Avisos** (opcionales, puedes poner varios):

| Canal | Qué poner |
|---|---|
| Slack | URL del *Incoming Webhook* |
| Discord | URL del webhook del canal |
| Telegram | `TOKEN_DEL_BOT:CHAT_ID` |
| Email | La dirección (requiere SMTP configurado en el servidor) |
| Webhook | Una URL que recibirá un POST con el resultado en JSON |

Marca **Solo fallos** para no recibir avisos cuando todo va bien. Con **Enviar prueba** compruebas la configuración.

## Seguimiento

Cada monitor muestra:
- **Disponibilidad**: porcentaje de ejecuciones correctas.
- **Duración media** y una **gráfica** de las últimas ejecuciones (verde = OK, rojo = fallo).
- **Próxima** ejecución y la última.
- El detalle de cada ejecución, igual que en el runner.

Usa **Ejecutar ahora** para probarlo y el interruptor para pausarlo.

> Los monitores no guardan los cambios de variables que hagan los scripts, para no interferir con tu trabajo.
