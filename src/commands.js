import { canRunCommand } from "./access.js";
import { FieldValue, getDb } from "./firebase.js";
import {
  getCustomFrameDetailBySuffix,
  listTodayBookings,
  listTodayCustomFrames,
  listUpcomingCustomFrames,
} from "./queries.js";

function normalizeBody(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeSenderId(value) {
  return String(value || "").split("@")[0].replace(/\D/g, "");
}

function getCommandKey(command, arg) {
  if (command === "/bk" && arg === "today") return "booking:list";
  if (command === "/cf" && arg === "today") return "custom_frame:list";
  if (command === "/cf" && ["next", "upcoming", "soon"].includes(arg)) return "custom_frame:list";
  if (command.startsWith("/cf-detail-")) return "custom_frame:list";
  if (command === "/help") return "help";
  if (command === "/register") return "group:register";
  return "unknown";
}

function helpText() {
  return [
    "Waroeng Foto Bot siap bantu.",
    "",
    "Command yang tersedia:",
    "/bk today - lihat booking studio hari ini",
    "/cf today - lihat custom frame hari ini",
    "/cf next - lihat 10 custom frame selanjutnya",
    "/cf-detail-[kode] - buka detail custom frame dari kode ID",
    "/register - daftarkan grup ini sebagai tujuan bot",
    "",
    "Akses command dibatasi untuk nomor staf yang sudah diizinkan.",
  ].join("\n");
}

async function registerGroup(message) {
  const chat = await getMessageChat(message);
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
  const chatId = getMessageChatId(message);
  if (!chatId.endsWith("@g.us")) return;

  const chat = await getMessageChat(message);
  if (!chat?.isGroup) return;

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

function getMessageChatId(message) {
  return String(message.fromMe ? message.to : message.from || "");
}

async function getMessageChat(message) {
  const chatId = getMessageChatId(message);
  if (message.fromMe && chatId && message.client?.getChatById) {
    return message.client.getChatById(chatId);
  }
  return message.getChat();
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
  const sender = message.fromMe ? "self" : await senderPhone(message);
  console.log("WA command received", { command, arg, commandKey, sender, fromMe: Boolean(message.fromMe) });

  const access = await canAccessMessageCommand(message, commandKey);
  if (!access.ok) {
    console.log("WA command ignored: sender not allowed", { command, commandKey, sender });
    return;
  }

  if (command === "/help") {
    await message.reply(helpText());
    return;
  }

  if (command === "/register") {
    await message.reply(await registerGroup(message));
    return;
  }

  if (commandKey === "unknown") {
    await message.reply("Command belum dikenal. Ketik /help untuk melihat daftar command yang aktif.");
    return;
  }

  if (commandKey === "booking:list") {
    await message.reply(await listTodayBookings());
    return;
  }

  if (commandKey === "custom_frame:list") {
    if (command.startsWith("/cf-detail-")) {
      const code = commandRaw.slice("/cf-detail-".length);
      await message.reply(await getCustomFrameDetailBySuffix(code));
      return;
    }
    if (["next", "upcoming", "soon"].includes(arg)) {
      await message.reply(await listUpcomingCustomFrames());
      return;
    }
    await message.reply(await listTodayCustomFrames());
  }
}
