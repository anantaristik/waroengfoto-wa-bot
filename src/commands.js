import { canRunCommand } from "./access.js";
import { FieldValue, getDb } from "./firebase.js";
import { listTodayBookings, listTodayCustomFrames } from "./queries.js";

function normalizeBody(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeSenderId(value) {
  return String(value || "").split("@")[0].replace(/\D/g, "");
}

function getCommandKey(command, arg) {
  if (command === "/bk" && arg === "today") return "booking:list";
  if (command === "/cf" && arg === "today") return "custom_frame:list";
  if (command === "/help") return "help";
  if (command === "/register") return "group:register";
  return "unknown";
}

function helpText() {
  return [
    "Command Bot Waroeng Foto",
    "",
    "/bk today",
    "List booking studio hari ini",
    "",
    "/cf today",
    "List custom frame hari ini",
    "",
    "/help",
    "Lihat command",
  ].join("\n");
}

async function registerGroup(message) {
  const chat = await message.getChat();
  if (!chat.isGroup) return "Command /register hanya untuk grup.";

  const db = getDb();
  await db.collection("wa_bot_groups").doc(chat.id._serialized).set(
    {
      groupId: chat.id._serialized,
      groupName: chat.name || "",
      participantCount: Array.isArray(chat.participants) ? chat.participants.length : null,
      isRegistered: true,
      lastCommand: "/register",
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return `Grup terdaftar: ${chat.name || chat.id._serialized}`;
}

async function syncGroupInbox(message, rawText) {
  const chat = await message.getChat();
  if (!chat.isGroup) return;

  const db = getDb();
  await db.collection("wa_bot_groups").doc(chat.id._serialized).set(
    {
      groupId: chat.id._serialized,
      groupName: chat.name || "",
      participantCount: Array.isArray(chat.participants) ? chat.participants.length : null,
      lastCommand: rawText,
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function senderPhone(message) {
  if (message.author) return normalizeSenderId(message.author);
  return normalizeSenderId(message.from);
}

async function canAccessMessageCommand(message, commandKey) {
  if (message.fromMe) return { ok: true, source: "self" };
  return canRunCommand(await senderPhone(message), commandKey);
}

export async function handleIncomingMessage(message) {
  const rawText = normalizeBody(message.body);
  if (!rawText.startsWith("/")) return;

  await syncGroupInbox(message, rawText);

  const [commandRaw, argRaw = ""] = rawText.split(" ");
  const command = commandRaw.toLowerCase();
  const arg = argRaw.toLowerCase();
  const commandKey = getCommandKey(command, arg);

  if (command === "/help") {
    await message.reply(helpText());
    return;
  }

  if (command === "/register") {
    const access = await canAccessMessageCommand(message, commandKey);
    if (!access.ok) {
      await message.reply("Nomor kamu belum punya akses untuk register grup bot.");
      return;
    }
    await message.reply(await registerGroup(message));
    return;
  }

  if (commandKey === "unknown") {
    await message.reply("Command belum dikenal. Gunakan /help.");
    return;
  }

  const access = await canAccessMessageCommand(message, commandKey);
  if (!access.ok) {
    await message.reply("Nomor kamu belum punya akses command bot.");
    return;
  }

  if (commandKey === "booking:list") {
    await message.reply(await listTodayBookings());
    return;
  }

  if (commandKey === "custom_frame:list") {
    await message.reply(await listTodayCustomFrames());
  }
}
