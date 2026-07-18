import { getDb } from "./firebase.js";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "staff", "operator", "operasional", "karyawan"]);

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function phoneCandidates(phone) {
  const normalized = normalizePhone(phone);
  const local = normalized.startsWith("62") ? `0${normalized.slice(2)}` : normalized;
  return Array.from(new Set([phone, normalized, local].filter(Boolean)));
}

function hasAllowedRole(data) {
  const role = String(data.role || "").toLowerCase();
  const accessRole = String(data.accessRole || "").toLowerCase();
  return ALLOWED_ROLES.has(role) || ALLOWED_ROLES.has(accessRole);
}

async function findAllowlist(phone, commandKey) {
  const db = getDb();
  for (const candidate of phoneCandidates(phone)) {
    const snap = await db
      .collection("wa_bot_command_access")
      .where("phone", "==", candidate)
      .where("isActive", "==", true)
      .limit(1)
      .get();
    if (snap.empty) continue;

    const data = snap.docs[0].data() || {};
    const allowedCommands = Array.isArray(data.allowedCommands) ? data.allowedCommands.map(String) : [];
    if (!allowedCommands.length || allowedCommands.includes(commandKey) || allowedCommands.includes("*")) {
      return { ok: true, source: "allowlist", data };
    }
  }
  return null;
}

async function findUserByPhone(phone) {
  const db = getDb();
  const fields = ["phone", "whatsapp", "customerWhatsapp", "phoneNumber", "noWhatsapp"];
  for (const candidate of phoneCandidates(phone)) {
    for (const field of fields) {
      const snap = await db.collection("users").where(field, "==", candidate).limit(1).get();
      if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() || {} };
    }
  }
  return null;
}

export async function canRunCommand(senderPhone, commandKey) {
  const allowlist = await findAllowlist(senderPhone, commandKey);
  if (allowlist) return allowlist;

  const user = await findUserByPhone(senderPhone);
  if (!user) return { ok: false, reason: "not_registered" };
  if (user.data.isActive === false || user.data.disabled === true) return { ok: false, reason: "inactive" };
  if (!hasAllowedRole(user.data)) return { ok: false, reason: "role_not_allowed" };

  return { ok: true, source: "users", userId: user.id, data: user.data };
}

