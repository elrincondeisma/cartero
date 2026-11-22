> 🌐 **English** · [Español](es/09-monitores.md)

# Monitors

A monitor runs a collection **on a schedule** and alerts you when something fails. Use it to make sure your API (or third-party APIs you depend on) keeps working.

## Create a monitor

**Monitors → New**:

- **Collection** and **environment**.
- **Frequency**: every 5 or 15 minutes, hourly, daily or a custom **cron** (`minute hour day month weekday`, e.g. `0 9 * * 1-5` = weekdays at 9:00).
- **Time zone**.
- **Alerts** (optional, you can add several):

| Channel | What to enter |
|---|---|
| Slack | *Incoming Webhook* URL |
| Discord | The channel's webhook URL |
| Telegram | `BOT_TOKEN:CHAT_ID` |
| Email | The address (requires SMTP configured on the server) |
| Webhook | A URL that will receive a POST with the result as JSON |

Tick **Failures only** to skip alerts when everything passes. **Send test** checks your configuration.

## Tracking

Each monitor shows:
- **Uptime**: percentage of successful runs.
- **Average duration** and a **chart** of recent runs (green = passed, red = failed).
- The **next** and last run.
- The details of every run, just like the runner.

Use **Run now** to try it and the toggle to pause it.

> Monitors don't save variable changes made by scripts, so they never interfere with your work.
