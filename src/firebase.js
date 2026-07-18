import admin from "firebase-admin";

function credentialFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return admin.credential.applicationDefault();

  const parsed = JSON.parse(raw);
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return admin.credential.cert(parsed);
}

export function getAdminApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp({
    credential: credentialFromEnv(),
  });
}

export function getDb() {
  getAdminApp();
  return admin.firestore();
}

export const FieldValue = admin.firestore.FieldValue;

