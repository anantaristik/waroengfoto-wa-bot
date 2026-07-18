import { getDb } from "./firebase.js";
import { getTodayInTimezone } from "./time.js";

const BOOKING_COLLECTION = "studio_bookings";
const CUSTOM_FRAME_COLLECTION = "custom_frame_requests";

function formatTimeRange(item) {
  return [item.startTime, item.endTime].filter(Boolean).join("-") || "-";
}

function compactBookingLine(item, index) {
  const code = item.publicBookingCode || item.bookingId || item.id || "-";
  const customer = item.customerName || "-";
  const product = item.productName || item.productId || "-";
  const branch = item.branchName || item.branchCode || item.branchId || "-";
  const status = [item.paymentStatus, item.bookingStatus].filter(Boolean).join("/");
  return `${index + 1}. ${code}\n${customer} • ${product}\n${branch} • ${formatTimeRange(item)} • ${status || "-"}`;
}

function compactCustomFrameLine(item, index) {
  const code = item.publicRequestId || item.requestId || item.id || "-";
  const customer = item.namaPemesan || item.customerName || "-";
  const product = item.productTitle || item.judulFrame || item.ukuranFrame || "-";
  const branch = item.branchName || item.branchId || "-";
  const status = item.submissionStatus || item.status || "-";
  return `${index + 1}. ${code}\n${customer} • ${product}\n${branch} • ${status}`;
}

export async function listTodayBookings() {
  const db = getDb();
  const today = getTodayInTimezone();
  const snap = await db
    .collection(BOOKING_COLLECTION)
    .where("bookingDate", "==", today)
    .limit(20)
    .get();
  const items = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));

  if (!items.length) return `Booking hari ini (${today})\n\nBelum ada booking.`;
  return [`Booking hari ini (${today})`, "", ...items.map(compactBookingLine)].join("\n\n");
}

export async function listTodayCustomFrames() {
  const db = getDb();
  const today = getTodayInTimezone();
  const fields = ["tanggalPemakaian", "bookingDate", "date"];
  const byId = new Map();

  for (const field of fields) {
    const snap = await db.collection(CUSTOM_FRAME_COLLECTION).where(field, "==", today).limit(20).get();
    snap.docs.forEach((doc) => byId.set(doc.id, { id: doc.id, ...doc.data() }));
  }

  const items = Array.from(byId.values()).sort((a, b) =>
    String(a.perkiraanJamKedatangan || a.startTime || "").localeCompare(String(b.perkiraanJamKedatangan || b.startTime || "")),
  );

  if (!items.length) return `Custom Frame hari ini (${today})\n\nBelum ada custom frame.`;
  return [`Custom Frame hari ini (${today})`, "", ...items.map(compactCustomFrameLine)].join("\n\n");
}

