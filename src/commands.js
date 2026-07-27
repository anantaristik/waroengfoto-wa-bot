import { canRunCommand } from "./access.js";
import { FieldValue, getDb } from "./firebase.js";
import {
  getBookingDetailBySuffix,
  getCustomFrameDetailBySuffix,
  listBookingsByDate,
  listCustomFramesByDate,
  listTodayBookings,
  listTodayCustomFrames,
  listUpcomingBookings,
  listUpcomingCustomFrames,
} from "./queries.js";
import { AUTO_GROUP_ROUTES, buildGroupRegistrationWrites, fallbackGroupChat } from "./groupRegistration.js";

const GROUP_COLLECTION = "wa_bot_groups";
const ROUTE_COLLECTION = "wa_bot_notification_routes";

function normalizeBody(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeSenderId(value) {
  return String(value || "").split("@")[0].replace(/\D/g, "");
}

function getCommandKey(command, arg) {
  if (command === "/bk" && arg === "today") return "booking:list";
  if (command === "/bk" && /^\d{6}$/.test(arg)) return "booking:list";
  if (command === "/bk" && ["next", "upcoming", "soon"].includes(arg)) return "booking:list";
  if (command.startsWith("/bk-detail-")) return "booking:list";
  if (command === "/cf" && arg === "today") return "custom_frame:list";
  if (command === "/cf" && /^\d{6}$/.test(arg)) return "custom_frame:list";
  if (command === "/cf" && ["next", "upcoming", "soon"].includes(arg)) return "custom_frame:list";
  if (command.startsWith("/cf-detail-")) return "custom_frame:list";
  if (command === "/help") return "help";
  if (command === "/register") return "group:register";
  return "unknown";
}

function parseDdmmyy(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!match) return "";

  const [, day, month, year] = match;
  const fullYear = `20${year}`;
  const date = new Date(Date.UTC(Number(fullYear), Number(month) - 1, Number(day)));
  const isValid =
    date.getUTCFullYear() === Number(fullYear) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  if (!isValid) return "";

  return `${fullYear}-${month}-${day}`;
}

function helpText() {
  return [
    "Waroeng Foto Bot siap bantu.",
    "",
    "BOOKING STUDIO",
    "/bk today - list booking hari ini",
    "/bk next - 10 booking terdekat dari hari ini",
    "/bk ddmmyy - list booking tanggal tertentu, contoh /bk 020626",
    "/bk-detail-[kode] - detail booking dari kode pendek di list",
    "",
    "CUSTOM FRAME",
    "/cf today - list custom frame hari ini",
    "/cf next - 10 custom frame terdekat dari hari ini",
    "/cf ddmmyy - list custom frame tanggal tertentu, contoh /cf 020626",
    "/cf-detail-[kode] - detail custom frame dari kode pendek di list",
    "",
    "SETTING GRUP",
    "/register - daftarkan grup ini sebagai tujuan notifikasi otomatis",
    "",
    "Catatan: command hanya dibalas untuk nomor staf yang sudah diizinkan.",
  ].join("\n");
}

async function registerGroup(message) {
  const chat = await getMessageChat(message, { allowGroupFallback: true });
  if (!chat.isGroup) return "Command /register hanya untuk grup.";

  const db = getDb();
  const groupId = chat.id._serialized;
  const groupName = chat.name || "";
  const participantCount = Array.isArray(chat.participants) ? chat.participants.length : null;
  const now = FieldValue.serverTimestamp();
  const { groupData, routeWrites } = buildGroupRegistrationWrites({ groupId, groupName, participantCount }, now);

  const batch = db.batch();
  batch.set(
    db.collection(GROUP_COLLECTION).doc(groupId),
    groupData,
    { merge: true },
  );

  for (const route of routeWrites) {
    batch.set(
      db.collection(ROUTE_COLLECTION).doc(route.routeKey),
      route.data,
      { merge: true },
    );
  }

  await batch.commit();

  const labels = AUTO_GROUP_ROUTES.map((route) => route.label).join(" dan ");
  return `Grup terdaftar: ${groupName || groupId}. Notifikasi otomatis aktif untuk ${labels}.`;
}

async function syncGroupInbox(message, rawText) {
  const chatId = getMessageChatId(message);
  if (!chatId.endsWith("@g.us")) return;

  const chat = await getMessageChat(message, { allowGroupFallback: true });
  if (!chat?.isGroup) return;

  const db = getDb();
  await db.collection(GROUP_COLLECTION).doc(chat.id._serialized).set(
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
  const phones = await senderPhones(message);
  return phones[0] || "";
}

async function senderPhones(message) {
  const values = [message.author, message.from];

  try {
    const contact = await message.getContact();
    values.unshift(contact?.number, contact?.id?.user);
  } catch (error) {
    console.error("Failed to resolve WhatsApp contact", error);
  }

  return Array.from(new Set(values.map(normalizeSenderId).filter(Boolean)));
}

function getMessageChatId(message) {
  return String(message.fromMe ? message.to : message.from || "");
}

async function getMessageChat(message, options = {}) {
  const chatId = getMessageChatId(message);
  const attempts = [];

  if (message.fromMe && chatId && message.client?.getChatById) {
    attempts.push(() => message.client.getChatById(chatId));
  }
  if (message.getChat) {
    attempts.push(() => message.getChat());
  }
  if (!message.fromMe && chatId && message.client?.getChatById) {
    attempts.push(() => message.client.getChatById(chatId));
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  const fallback = options.allowGroupFallback ? fallbackGroupChat(chatId, message) : null;
  if (fallback) {
    console.warn("Using fallback WhatsApp group chat data", { chatId });
    return fallback;
  }

  throw lastError || new Error("Unable to resolve WhatsApp chat");
}

async function canAccessMessageCommand(message, commandKey) {
  if (message.fromMe) return { ok: true, source: "self" };

  const phones = await senderPhones(message);
  for (const phone of phones) {
    const access = await canRunCommand(phone, commandKey);
    if (access.ok) return access;
  }
  return { ok: false, reason: "not_allowed", phones };
}

export async function handleIncomingMessage(message) {
  const rawText = normalizeBody(message.body);
  if (!rawText.startsWith("/")) return;

  try {
    await syncGroupInbox(message, rawText);
  } catch (error) {
    console.error("Failed to sync WhatsApp group inbox", error);
  }

  const [commandRaw, argRaw = ""] = rawText.split(" ");
  const command = commandRaw.toLowerCase();
  const arg = argRaw.toLowerCase();
  const commandKey = getCommandKey(command, arg);
  const senders = message.fromMe ? ["self"] : await senderPhones(message);
  console.log("WA command received", { command, arg, commandKey, senders, fromMe: Boolean(message.fromMe) });

  const access = await canAccessMessageCommand(message, commandKey);
  if (!access.ok) {
    console.log("WA command ignored: sender not allowed", { command, commandKey, senders });
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
    if (command.startsWith("/bk-detail-")) {
      const code = commandRaw.slice("/bk-detail-".length);
      await message.reply(await getBookingDetailBySuffix(code));
      return;
    }
    if (["next", "upcoming", "soon"].includes(arg)) {
      await message.reply(await listUpcomingBookings());
      return;
    }
    if (/^\d{6}$/.test(arg)) {
      const date = parseDdmmyy(arg);
      if (!date) {
        await message.reply("Format tanggal belum valid. Pakai /bk ddmmyy, contoh /bk 020626.");
        return;
      }
      await message.reply(await listBookingsByDate(date));
      return;
    }
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
    if (/^\d{6}$/.test(arg)) {
      const date = parseDdmmyy(arg);
      if (!date) {
        await message.reply("Format tanggal belum valid. Pakai /cf ddmmyy, contoh /cf 020626.");
        return;
      }
      await message.reply(await listCustomFramesByDate(date));
      return;
    }
    await message.reply(await listTodayCustomFrames());
  }
}
