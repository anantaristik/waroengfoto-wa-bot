import { CONFIG } from "./config.js";
import { FieldValue, getDb } from "./firebase.js";
import {
  buildBookingSettledGroupMessage,
  buildCustomFrameSubmittedGroupMessage,
  buildStudioPhotoResultMessage,
} from "./formatters.js";
import { sendGroupMessage, sendPrivateMessage } from "./whatsapp.js";

const EVENT_BOOKING_SETTLED = "booking.settled.notify_group";
const EVENT_CUSTOM_FRAME_SUBMITTED = "custom_frame.submitted.notify_group";
const EVENT_STUDIO_PHOTO_RESULT = "studio_photo_result.send_whatsapp";
const DELIVERY_COLLECTION = "wa_bot_deliveries";
const BOOKING_COLLECTION = "studio_bookings";

async function claimDelivery(db, doc) {
  const ref = doc.ref;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data() || {};
    if (data.status !== "pending") return null;

    const attempts = Number(data.attempts || 0);
    if (attempts >= CONFIG.maxAttempts) {
      tx.set(
        ref,
        {
          status: "failed",
          errorMessage: "Max attempts exceeded",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return null;
    }

    tx.set(
      ref,
      {
        status: "processing",
        attempts: attempts + 1,
        processingStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { id: snap.id, ...data, attempts: attempts + 1 };
  });
}

async function markBookingWhatsappStatus(db, delivery, status, patch = {}) {
  if (delivery.eventType !== EVENT_STUDIO_PHOTO_RESULT) return;
  if (delivery.sourceType !== "studio_booking" || !delivery.sourceId) return;
  await db.collection(BOOKING_COLLECTION).doc(delivery.sourceId).set(
    {
      photoResultWhatsappStatus: status,
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function markSent(db, delivery, messageId) {
  await db.collection(DELIVERY_COLLECTION).doc(delivery.id).set(
    {
      status: "sent",
      whatsappMessageId: messageId ? String(messageId) : null,
      errorMessage: null,
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await markBookingWhatsappStatus(db, delivery, "sent", {
    photoResultWhatsappSentAt: FieldValue.serverTimestamp(),
    photoResultWhatsappError: null,
  });
}

async function markFailed(db, delivery, error) {
  const message = error instanceof Error ? error.message : "Gagal mengirim WhatsApp";
  await db.collection(DELIVERY_COLLECTION).doc(delivery.id).set(
    {
      status: "failed",
      errorMessage: message.slice(0, 1000),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await markBookingWhatsappStatus(db, delivery, "failed", {
    photoResultWhatsappError: message.slice(0, 1000),
  });
}

async function processStudioPhotoResult(client, delivery) {
  const resultLink = String(delivery.payload?.resultLink || "").trim();
  if (!resultLink) throw new Error("Delivery tidak memiliki resultLink");
  const message = buildStudioPhotoResultMessage(delivery);
  const sent = await sendPrivateMessage(client, delivery.targetPhone, message);
  return sent?.id?._serialized || sent?.id?.id || null;
}

async function processBookingSettled(client, delivery) {
  const message = buildBookingSettledGroupMessage(delivery);
  const sent = await sendGroupMessage(client, delivery.targetGroupId, message);
  return sent?.id?._serialized || sent?.id?.id || null;
}

async function processCustomFrameSubmitted(client, delivery) {
  const message = buildCustomFrameSubmittedGroupMessage(delivery);
  const sent = await sendGroupMessage(client, delivery.targetGroupId, message);
  return sent?.id?._serialized || sent?.id?.id || null;
}

async function processDelivery(client, delivery) {
  if (delivery.eventType === EVENT_BOOKING_SETTLED) {
    return processBookingSettled(client, delivery);
  }
  if (delivery.eventType === EVENT_CUSTOM_FRAME_SUBMITTED) {
    return processCustomFrameSubmitted(client, delivery);
  }
  if (delivery.eventType === EVENT_STUDIO_PHOTO_RESULT) {
    return processStudioPhotoResult(client, delivery);
  }
  throw new Error(`Unsupported delivery event: ${delivery.eventType}`);
}

export async function processPendingDeliveries(client) {
  const db = getDb();
  const snap = await db
    .collection(DELIVERY_COLLECTION)
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(10)
    .get();

  for (const doc of snap.docs) {
    const delivery = await claimDelivery(db, doc);
    if (!delivery) continue;

    try {
      const messageId = await processDelivery(client, delivery);
      await markSent(db, delivery, messageId);
      console.log("WA delivery sent", delivery.id);
    } catch (error) {
      console.error("WA delivery failed", delivery.id, error);
      await markFailed(db, delivery, error);
    }
  }
}
