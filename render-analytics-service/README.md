# Render Analytics Service (API + Dashboard)

Deploy this as a **Render Web Service**. It provides:
- `/api/sessions/start`
- `/api/events`
- `/api/stats`
- `/api/registrations`
- dashboard UI at `/admin.html`

## Render settings
- Build command: `npm install`
- Start command: `npm start`

## Persistence (important)
Attach a **Persistent Disk** and set:
- Mount path: `/var/data`
- Env var: `DB_PATH=/var/data/data.sqlite`

If you skip this, data can be lost on redeploy/restart.

## CORS (important)
Set env var `ALLOWED_ORIGINS` (comma-separated):
Example:
`https://vefbordi.is,https://your-banner-host.com`

If you leave it unset, it allows all (`*`).

## Dashboard
- https://<your-service>.onrender.com/admin.html
- https://<your-service>.onrender.com/registrations.html
