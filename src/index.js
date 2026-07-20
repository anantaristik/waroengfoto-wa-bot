import { CONFIG } from "./config.js";
import { startApiServer } from "./api.js";
import { handleIncomingMessage } from "./commands.js";
import { processPendingDeliveries } from "./deliveries.js";
import { createWhatsAppClient } from "./whatsapp.js";

const client = createWhatsAppClient();
let loopStarted = false;
const handledMessages = new Set();

startApiServer();

async function runLoop() {
  if (loopStarted) return;
  loopStarted = true;

  while (true) {
    try {
      await processPendingDeliveries(client);
    } catch (error) {
      console.error("Delivery loop error", error);
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs));
  }
}

client.on("ready", () => {
  runLoop().catch((error) => {
    console.error("Failed to start delivery loop", error);
    process.exitCode = 1;
  });
});

function messageKey(message) {
  return message.id?._serialized || message.id?.id || `${message.from || ""}:${message.to || ""}:${message.timestamp || ""}:${message.body || ""}`;
}

function handleMessageEvent(message, label) {
  const key = messageKey(message);
  if (handledMessages.has(key)) return;
  handledMessages.add(key);
  setTimeout(() => handledMessages.delete(key), 5 * 60 * 1000).unref?.();

  handleIncomingMessage(message).catch((error) => {
    console.error(`Failed to handle ${label} message`, error);
  });
}

client.on("message", (message) => handleMessageEvent(message, "incoming"));
client.on("message_create", (message) => handleMessageEvent(message, "created"));

client.initialize().catch((error) => {
  console.error("Failed to initialize WhatsApp client", error);
  process.exitCode = 1;
});
