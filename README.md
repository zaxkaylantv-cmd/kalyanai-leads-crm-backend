# Kalyan AI Leads CRM Backend

Backend API for a lightweight CRM that tracks leads, deals, activities, outreach steps, reminders, and AI-assisted sales content.

## Requirements
- Node.js (recent LTS recommended)
- npm

## Setup
1) Install dependencies: `npm install`
2) Environment variables: create a `.env` (or export vars) with the keys below. AI/email features gracefully stub/disable when missing keys.
3) Database: created automatically as SQLite at `data/leads-crm.sqlite` on first run.

## Environment variables
- `PORT` (default 3003)
- `OPENAI_API_KEY`
- `REMINDER_EMAIL_FROM`
- `REMINDER_EMAIL_TO`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`

## Run
- Dev (watch): `npm run dev`
- Prod: `npm start`

## API summary
- Health: `GET /health`
- Reminders & settings: `GET /reminders/today`, `GET /reminders/today/email-preview`, `GET|POST /settings/reminders`, `POST /reminders/today/send-email`
- Leads & deals: `GET /leads`, `POST /leads`, `POST /leads/:leadId/owner`, `DELETE /leads/:leadId`; `GET /deals`, `POST /deals`, `POST /deals/:dealId/details`, `POST /deals/:dealId/stage`
- Activities & outreach: `GET /deals/:dealId/activities`, `POST /deals/:dealId/activities`, `GET /deals/:dealId/outreach-steps`, `PATCH /outreach-steps/:stepId/status`
- AI endpoints: `/ai/outreach-plan`, `/ai/next-step`, `/ai/deal-recovery`, `/ai/reminder-text`, `/ai/message-draft`, `/ai/leads-summary`, `/ai/pipeline-insights`

## Database notes
- SQLite file: `data/leads-crm.sqlite`
- Tables created automatically: leads, deals, settings, outreach_steps, activities, reminder_logs (owner columns added idempotently).

## Troubleshooting

- AI endpoints return stub responses if `OPENAI_API_KEY` is unset.
- Email sending is disabled with a warning unless all SMTP_* variables are provided.
- Ensure `data/` is writable so SQLite can create/update `leads-crm.sqlite`.

## Safety
- CORS enabled; no authentication is enforced by default—deploy behind trusted networks.
- Deleting a lead removes related data via backend routines; use with caution.
