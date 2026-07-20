import express from "express";
import { CONFIG } from "./config.js";
import { FieldValue, getDb } from "./firebase.js";
import {
  buildBookingSettledGroupMessage,
  buildCustomFrameSubmittedGroupMessage,
  buildStudioPhotoResultMessage,
} from "./formatters.js";

const DELIVERY_COLLECTION = "wa_bot_deliveries";
const ROUTE_COLLECTION = "wa_bot_notification_routes";
const BOOKING_COLLECTION = "studio_bookings";
const CUSTOM_FRAME_COLLECTION = "custom_frame_requests";

const ROUTES = {
  booking_settled: {
    routeKey: "booking_settled",
    eventType: "booking.settled.notify_group",
    sourceType: "studio_booking",
  },
  custom_frame_submitted: {
    routeKey: "custom_frame_submitted",
    eventType: "custom_frame.submitted.notify_group",
    sourceType: "custom_frame_request",
  },
};

function cleanString(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  const digits = cleanString(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function safeDocId(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 400);
}

function isValidUrl(value) {
  try {
    const url = new URL(cleanString(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isPaymentVerified(data) {
  const paymentStatus = cleanString(data.paymentStatus).toLowerCase();
  const bookingStatus = cleanString(data.bookingStatus).toLowerCase();
  return (
    ["paid", "settled", "confirmed", "completed"].includes(paymentStatus) ||
    ["confirmed", "checked_in", "completed"].includes(bookingStatus)
  );
}

function authMiddleware(req, res, next) {
  if (!CONFIG.apiToken) {
    return res.status(503).json({ error: "WA_BOT_API_TOKEN belum dikonfigurasi" });
  }

  const header = cleanString(req.headers.authorization);
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (token !== CONFIG.apiToken) return res.status(401).json({ error: "UNAUTHORIZED" });
  return next();
}

async function getRoute(routeKey) {
  const db = getDb();
  const route = ROUTES[routeKey];
  if (!route) throw new Error(`Route tidak dikenal: ${routeKey}`);

  const snap = await db.collection(ROUTE_COLLECTION).doc(routeKey).get();
  const data = snap.data() || {};
  if (!data.enabled || !cleanString(data.groupId)) {
    return { ok: false, status: "route_disabled", routeKey };
  }

  return {
    ok: true,
    routeKey,
    eventType: route.eventType,
    sourceType: route.sourceType,
    groupId: cleanString(data.groupId),
    groupName: cleanString(data.groupName),
  };
}

async function createDelivery({ deliveryId, data, sourcePatch }) {
  const db = getDb();
  const ref = db.collection(DELIVERY_COLLECTION).doc(deliveryId);
  const now = FieldValue.serverTimestamp();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data() || {};
    const status = cleanString(current.status);

    if (snap.exists && ["pending", "processing", "sent"].includes(status)) {
      return { created: false, status, deliveryId };
    }

    tx.set(
      ref,
      {
        ...data,
        status: "pending",
        attempts: Number(current.attempts || 0),
        errorMessage: null,
        createdAt: snap.exists ? current.createdAt || now : now,
        updatedAt: now,
      },
      { merge: true },
    );

    if (sourcePatch?.collection && sourcePatch.id && sourcePatch.data) {
      tx.set(db.collection(sourcePatch.collection).doc(sourcePatch.id), sourcePatch.data(now, deliveryId), { merge: true });
    }

    return { created: true, status: "queued", deliveryId };
  });
}

function buildBookingCodes(data, docId) {
  const bookingId = cleanString(data.bookingId || docId);
  const match = bookingId.match(/^STUDIO-(\d{8})-([A-Z0-9]+)$/i);
  const suffix = match?.[2]?.toUpperCase() || bookingId.split("-").pop()?.toUpperCase() || bookingId;
  return {
    bookingId,
    publicBookingCode: cleanString(data.publicBookingCode || `WF-${suffix}`),
  };
}

async function queueBookingSettled(req, res) {
  const db = getDb();
  const bookingId = cleanString(req.body?.bookingId);
  if (!bookingId) return res.status(400).json({ error: "bookingId wajib diisi" });

  const route = await getRoute("booking_settled");
  if (!route.ok) return res.status(409).json(route);

  const snap = await db.collection(BOOKING_COLLECTION).doc(bookingId).get();
  if (!snap.exists) return res.status(404).json({ error: "Booking tidak ditemukan" });

  const booking = snap.data() || {};
  if (!isPaymentVerified(booking)) return res.status(400).json({ error: "Booking belum settled/verified" });

  const codes = buildBookingCodes(booking, snap.id);
  const payload = {
    bookingId: snap.id,
    publicBookingCode: codes.publicBookingCode,
    customerName: cleanString(booking.customerName),
    customerWhatsapp: cleanString(booking.customerWhatsapp),
    branchName: cleanString(booking.branchName),
    branchCode: cleanString(booking.branchCode),
    bookingDate: cleanString(booking.bookingDate),
    startTime: cleanString(booking.startTime),
    endTime: cleanString(booking.endTime),
    productName: cleanString(booking.productName),
    backgroundName: cleanString(booking.backgroundName),
    totalPayment: Number(booking.totalPayment || booking.pakasirTotalPayment || 0),
    pakasirTotalPayment: Number(booking.pakasirTotalPayment || 0),
    paymentStatus: cleanString(booking.paymentStatus || "paid"),
  };
  const idempotencyKey = safeDocId(req.body?.idempotencyKey || `${snap.id}:${booking.paidAt?.seconds || "paid"}`);
  const deliveryId = `${route.eventType}:${idempotencyKey}`;
  const delivery = {
    eventType: route.eventType,
    sourceType: route.sourceType,
    sourceId: snap.id,
    targetType: "group",
    targetGroupId: route.groupId,
    targetGroupName: route.groupName,
    messagePreview: buildBookingSettledGroupMessage({ payload, sourceId: snap.id }),
    payload,
    createdByName: cleanString(req.body?.createdByName || "waroengfoto.com"),
  };

  const result = await createDelivery({ deliveryId, data: delivery });
  return res.status(200).json({ ok: true, ...result });
}

async function queueCustomFrameSubmitted(req, res) {
  const db = getDb();
  const requestId = cleanString(req.body?.requestId);
  if (!requestId) return res.status(400).json({ error: "requestId wajib diisi" });

  const route = await getRoute("custom_frame_submitted");
  if (!route.ok) return res.status(409).json(route);

  const snap = await db.collection(CUSTOM_FRAME_COLLECTION).doc(requestId).get();
  if (!snap.exists) return res.status(404).json({ error: "Custom frame tidak ditemukan" });

  const item = snap.data() || {};
  if (!item.buktiPembayaran) return res.status(400).json({ error: "Bukti pembayaran belum ada" });

  const payload = {
    requestId: snap.id,
    publicRequestId: cleanString(item.publicRequestId || snap.id),
    namaPemesan: cleanString(item.namaPemesan),
    noWhatsapp: cleanString(item.noWhatsapp),
    branchName: cleanString(item.branchName),
    branchCode: cleanString(item.branchCode),
    tanggalPemakaian: cleanString(item.tanggalPemakaian),
    perkiraanJamKedatangan: cleanString(item.perkiraanJamKedatangan),
    productTitle: cleanString(item.productTitle),
    ukuranFrame: cleanString(item.ukuranFrame),
    judulFrame: cleanString(item.judulFrame),
    metodeEdit: cleanString(item.metodeEdit),
    isExpress: Boolean(item.isExpress),
    totalPrice: Number(item.totalPrice || 0),
  };
  const idempotencyKey = safeDocId(req.body?.idempotencyKey || snap.id);
  const deliveryId = `${route.eventType}:${idempotencyKey}`;
  const delivery = {
    eventType: route.eventType,
    sourceType: route.sourceType,
    sourceId: snap.id,
    targetType: "group",
    targetGroupId: route.groupId,
    targetGroupName: route.groupName,
    messagePreview: buildCustomFrameSubmittedGroupMessage({ payload, sourceId: snap.id }),
    payload,
    createdByName: cleanString(req.body?.createdByName || "custom.waroengfoto.com"),
  };

  const result = await createDelivery({ deliveryId, data: delivery });
  return res.status(200).json({ ok: true, ...result });
}

async function queueStudioResult(req, res) {
  const db = getDb();
  const bookingId = cleanString(req.body?.bookingId);
  const resultLink = cleanString(req.body?.resultLink);
  if (!bookingId || !resultLink) return res.status(400).json({ error: "bookingId dan resultLink wajib diisi" });
  if (!isValidUrl(resultLink)) return res.status(400).json({ error: "Link hasil foto tidak valid" });

  const snap = await db.collection(BOOKING_COLLECTION).doc(bookingId).get();
  if (!snap.exists) return res.status(404).json({ error: "Booking tidak ditemukan" });

  const booking = snap.data() || {};
  if (!isPaymentVerified(booking)) return res.status(400).json({ error: "Booking belum settled/verified" });

  const targetPhone = normalizePhone(booking.customerWhatsapp);
  if (targetPhone.length < 10) return res.status(400).json({ error: "Nomor WhatsApp customer kosong atau tidak valid" });

  const codes = buildBookingCodes(booking, snap.id);
  const payload = {
    bookingId: snap.id,
    resultLink,
    customerName: cleanString(booking.customerName),
    publicBookingCode: codes.publicBookingCode,
  };
  const idempotencyKey = safeDocId(req.body?.idempotencyKey || `${snap.id}:${targetPhone}`);
  const deliveryId = `studio_photo_result.send_whatsapp:${idempotencyKey}`;
  const delivery = {
    eventType: "studio_photo_result.send_whatsapp",
    sourceType: "studio_booking",
    sourceId: snap.id,
    targetType: "customer_private",
    targetPhone,
    messagePreview: buildStudioPhotoResultMessage({ payload, sourceId: snap.id }),
    payload,
    createdByUid: cleanString(req.body?.createdByUid),
    createdByName: cleanString(req.body?.createdByName || "hub.waroengfoto.com"),
  };

  const result = await createDelivery({
    deliveryId,
    data: delivery,
    sourcePatch: {
      collection: BOOKING_COLLECTION,
      id: snap.id,
      data: (now, nextDeliveryId) => ({
        photoResultDriveLink: resultLink,
        photoResultStatus: "link_ready",
        photoResultWhatsappStatus: "queued",
        photoResultWhatsappQueuedAt: now,
        photoResultWhatsappError: null,
        photoResultWhatsappDeliveryId: nextDeliveryId,
        photoResultUpdatedAt: now,
        updatedAt: now,
      }),
    },
  });
  return res.status(200).json({ ok: true, ...result });
}

async function listRoutes(_req, res) {
  const db = getDb();
  const snaps = await db.collection(ROUTE_COLLECTION).get();
  const configured = new Map(snaps.docs.map((doc) => [doc.id, doc.data() || {}]));
  return res.status(200).json({
    routes: Object.keys(ROUTES).map((routeKey) => ({
      routeKey,
      targetType: "group",
      enabled: Boolean(configured.get(routeKey)?.enabled),
      groupId: cleanString(configured.get(routeKey)?.groupId),
      groupName: cleanString(configured.get(routeKey)?.groupName),
      updatedAt: configured.get(routeKey)?.updatedAt || null,
      updatedBy: cleanString(configured.get(routeKey)?.updatedBy),
    })),
  });
}

async function updateRoute(req, res) {
  const routeKey = cleanString(req.params.routeKey);
  if (!ROUTES[routeKey]) return res.status(404).json({ error: "Route tidak dikenal" });

  const groupId = cleanString(req.body?.groupId);
  const enabled = Boolean(req.body?.enabled);
  if (enabled && !groupId.endsWith("@g.us")) return res.status(400).json({ error: "groupId WhatsApp tidak valid" });

  const db = getDb();
  await db.collection(ROUTE_COLLECTION).doc(routeKey).set(
    {
      routeKey,
      targetType: "group",
      enabled,
      groupId,
      groupName: cleanString(req.body?.groupName),
      updatedBy: cleanString(req.body?.updatedBy || "api"),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return res.status(200).json({ ok: true, routeKey, enabled, groupId });
}

export function startApiServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "waroengfoto-wa-bot" });
  });

  app.use("/api", authMiddleware);
  app.post("/api/notifications/booking-settled", (req, res) => queueBookingSettled(req, res).catch((error) => handleError(res, error)));
  app.post("/api/notifications/custom-frame-submitted", (req, res) =>
    queueCustomFrameSubmitted(req, res).catch((error) => handleError(res, error)),
  );
  app.post("/api/messages/studio-result", (req, res) => queueStudioResult(req, res).catch((error) => handleError(res, error)));
  app.get("/api/settings/routes", (req, res) => listRoutes(req, res).catch((error) => handleError(res, error)));
  app.put("/api/settings/routes/:routeKey", (req, res) => updateRoute(req, res).catch((error) => handleError(res, error)));

  app.listen(CONFIG.apiPort, () => {
    console.log(`WA bot API listening on ${CONFIG.apiPort}`);
  });
}

function handleError(res, error) {
  const message = error instanceof Error ? error.message : "WA bot API error";
  console.error("WA bot API error", error);
  return res.status(400).json({ error: message });
}
