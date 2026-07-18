export const CONFIG = {
  pollIntervalMs: Number(process.env.WA_POLL_INTERVAL_MS || 5000),
  maxAttempts: Number(process.env.WA_MAX_ATTEMPTS || 3),
  sessionPath: process.env.WA_SESSION_PATH || "/var/lib/waroengfoto-wa-bot/session",
  timezone: process.env.WA_TIMEZONE || "Asia/Jakarta",
};
