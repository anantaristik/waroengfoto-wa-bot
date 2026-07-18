# Waroeng Foto WhatsApp Bot

Long-running WhatsAppWeb worker for Waroeng Foto operational automation.

## Current Worker Scope

- Processes pending `wa_bot_deliveries`.
- Sends Booking Studio photo result links for event `studio_photo_result.send_whatsapp`.
- Updates delivery status and `studio_bookings.photoResultWhatsappStatus`.
- Handles command `/bk today` and `/cf today` for staff/admin numbers.
- Registers groups with `/register` into `wa_bot_groups`.

## Required Environment

- `FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`
- `WA_SESSION_PATH` outside Git, for example `/var/lib/waroengfoto-wa-bot/session`
- `WA_POLL_INTERVAL_MS`, optional, default `5000`
- `WA_MAX_ATTEMPTS`, optional, default `3`

## Commands

- `/help`
- `/register` in a group, by an allowed staff/admin number
- `/bk today` lists today's Booking Studio bookings
- `/cf today` lists today's Custom Frame requests

Command access checks `users` by WhatsApp-like phone fields and `wa_bot_command_access` allowlist.

## Run

```bash
npm install
npm start
```

First run prints a QR in the terminal. Scan it with the Waroeng Foto WhatsApp account.
