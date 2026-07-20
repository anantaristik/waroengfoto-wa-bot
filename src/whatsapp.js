import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { CONFIG } from "./config.js";

const { Client, LocalAuth } = pkg;

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export function createWhatsAppClient() {
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "waroengfoto-wa-bot",
      dataPath: CONFIG.sessionPath,
    }),
    puppeteer: {
      headless: true,
      timeout: 120000,
      protocolTimeout: 120000,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    },
  });

  client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
  });

  client.on("authenticated", () => {
    console.log("WhatsApp authenticated");
  });

  client.on("ready", () => {
    console.log("WhatsApp ready");
  });

  client.on("auth_failure", (message) => {
    console.error("WhatsApp auth failure", message);
  });

  client.on("disconnected", (reason) => {
    console.error("WhatsApp disconnected", reason);
  });

  return client;
}

export async function sendPrivateMessage(client, phone, message) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) throw new Error("Target WhatsApp tidak valid");
  return client.sendMessage(`${normalized}@c.us`, message);
}

export async function sendGroupMessage(client, groupId, message) {
  const target = String(groupId || "").trim();
  if (!target.endsWith("@g.us")) throw new Error("Target grup WhatsApp tidak valid");
  return client.sendMessage(target, message);
}
