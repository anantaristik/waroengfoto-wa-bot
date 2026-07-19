import { CONFIG } from "./config.js";
import { handleIncomingMessage } from "./commands.js";
import { processPendingDeliveries } from "./deliveries.js";
import { createWhatsAppClient } from "./whatsapp.js";

const client = createWhatsAppClient();
let loopStarted = false;

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

client.on("message", (message) => {
  handleIncomingMessage(message).catch((error) => {
    console.error("Failed to handle incoming message", error);
  });
});

client.on("message_create", (message) => {
  if (!message.fromMe) return;
  handleIncomingMessage(message).catch((error) => {
    console.error("Failed to handle outgoing message", error);
  });
});

client.initialize().catch((error) => {
  console.error("Failed to initialize WhatsApp client", error);
  process.exitCode = 1;
});
