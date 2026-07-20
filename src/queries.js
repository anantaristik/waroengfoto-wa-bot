import { getDb } from "./firebase.js";
import { formatDateLongID, getTodayInTimezone } from "./time.js";

const BOOKING_COLLECTION = "studio_bookings";
const CUSTOM_FRAME_COLLECTION = "custom_frame_requests";
const CUSTOM_FRAME_LOOKUP_LIMIT = 250;

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

function formatArrivalTime(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  const match = text.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return text;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function formatRupiah(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  })
    .format(amount)
    .replace(/\s/g, " ");
}

function normalizeStatus(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  const key = text.toUpperCase();
  const labels = {
    DRAFT: "Draft",
    SUBMITTING: "Sedang Dikirim",
    SUBMITTED: "Sudah Dimasukkan",
    FAILED: "Gagal",
    PROCESSING: "Diproses",
    DONE: "Selesai",
    COMPLETED: "Selesai",
    CANCELLED: "Dibatalkan",
    CANCELED: "Dibatalkan",
  };
  return labels[key] || text;
}

function customFrameStatus(item) {
  return normalizeStatus(item.progressStatus || item.submissionStatus || item.status);
}

function customFrameMethod(item) {
  if (item.metodeEdit === "EDIT_SENDIRI") return "Edit Sendiri";
  if (item.metodeEdit === "DIEDIT_WAROENGFOTO") return "Diedit Waroeng Foto";
  return item.metodeEdit || "-";
}

function customFrameDetailMethod(item) {
  if (item.metodeEdit === "EDIT_SENDIRI") {
    if (item.selfEditMode === "CANVA") return "Edit sendiri (Desain Canva)";
    if (item.selfEditMode === "UPLOAD_PNG") return "Edit sendiri (Upload PNG)";
    return "Edit sendiri";
  }
  if (item.metodeEdit === "DIEDIT_WAROENGFOTO") return "Diedit oleh Waroeng Foto";
  return item.metodeEdit || "-";
}

function customFrameExpressLabel(item) {
  return item.isExpress ? "Express" : "Bukan Express";
}

function customFrameCode(item) {
  return String(item.publicRequestId || item.requestId || item.id || "").trim();
}

function suffixForCode(code, length) {
  return String(code || "").replace(/\s/g, "").slice(-length).toLowerCase();
}

function uniqueSuffixes(items, minLength = 4) {
  const codes = items.map(customFrameCode);
  const suffixLengths = new Map();

  codes.forEach((code) => {
    let length = Math.min(Math.max(minLength, 1), Math.max(code.length, minLength));
    while (length < code.length) {
      const suffix = suffixForCode(code, length);
      const collision = codes.some((other) => other !== code && suffixForCode(other, length) === suffix);
      if (!collision) break;
      length += 1;
    }
    suffixLengths.set(code, length);
  });

  return new Map(codes.map((code) => [code, suffixForCode(code, suffixLengths.get(code) || minLength)]));
}

function compactCustomFrameLine(item, index, suffixByCode) {
  const code = customFrameCode(item);
  const shortCode = suffixByCode?.get(code) || suffixForCode(code, 4) || "-";
  const title = item.judulFrame || item.productTitle || item.ukuranFrame || "-";
  const customer = item.namaPemesan || item.customerName || "-";
  const branch = item.branchCode || item.branchName || item.branchId || "-";
  const product = item.productTitle || item.ukuranFrame || item.productId || "-";
  const schedule = [formatDateLongID(customFrameDate(item)), formatArrivalTime(item.perkiraanJamKedatangan || item.startTime)]
    .filter((value) => value && value !== "-")
    .join(", ");

  return [
    `${index + 1}. [${shortCode}] ${title}`,
    `   Customer: ${customer}`,
    `   Cabang: ${branch}`,
    `   Jadwal: ${schedule || "-"}`,
    `   Produk: ${product}`,
    `   Tipe: ${customFrameMethod(item)}, ${customFrameExpressLabel(item)}`,
    `   Progres: ${customFrameStatus(item)}`,
    `   Detail: /cf-detail-${shortCode}`,
  ].join("\n");
}

function formatCustomFrameList(title, items) {
  if (!items.length) return `${title}\n\nBelum ada custom frame.`;
  const suffixByCode = uniqueSuffixes(items);
  return [`*${title}*`, `Total: ${items.length} request`, "", ...items.map((item, index) => compactCustomFrameLine(item, index, suffixByCode))].join("\n\n");
}

function sortCustomFrames(items) {
  return items.sort((a, b) => {
    const dateDiff = String(a.tanggalPemakaian || a.bookingDate || a.date || "").localeCompare(
      String(b.tanggalPemakaian || b.bookingDate || b.date || ""),
    );
    if (dateDiff) return dateDiff;
    return String(a.perkiraanJamKedatangan || a.startTime || "").localeCompare(
      String(b.perkiraanJamKedatangan || b.startTime || ""),
    );
  });
}

function customFrameDate(item) {
  return item.tanggalPemakaian || item.bookingDate || item.date || "";
}

function instagramHandle(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.startsWith("@") ? text : `@${text}`;
}

function proofLabel(value) {
  if (!value) return "-";
  return "sudah diupload via form";
}

function formatCustomFrameDetail(item, duplicateCount = 0) {
  const code = customFrameCode(item) || item.id || "-";
  const lines = [
    `ID Request: ${code}`,
    "",
    "DATA CUSTOMER",
    `Nama: ${item.namaPemesan || item.customerName || "-"}`,
    `WhatsApp: ${item.noWhatsapp || item.customerWhatsapp || item.whatsapp || "-"}`,
    `Instagram: ${instagramHandle(item.usernameInstagram || item.instagram)}`,
    "",
    "DETAIL PESANAN",
    `Cabang: ${item.branchName || item.branchId || "-"}`,
    `Produk: ${item.productTitle || item.ukuranFrame || item.productId || "-"}`,
    `Judul frame: ${item.judulFrame || "-"}`,
    `Tanggal pemakaian: ${formatDateLongID(customFrameDate(item))}`,
    `Perkiraan jam kedatangan: ${formatArrivalTime(item.perkiraanJamKedatangan || item.startTime)}`,
    `Metode pembuatan: ${customFrameDetailMethod(item)}`,
    `Status express: ${item.isExpress ? "Ya" : "Tidak"}`,
    `Progres: ${customFrameStatus(item)}`,
    "",
    "RINCIAN PEMBAYARAN",
    `Biaya pembuatan: ${formatRupiah(item.basePrice)}`,
    `Biaya express: ${formatRupiah(item.expressSurcharge)}`,
    `Total: ${formatRupiah(item.totalPrice)}`,
    "",
    "DETAIL FILE / ASET",
  ];

  if (item.metodeEdit === "EDIT_SENDIRI") {
    if (item.selfEditMode === "UPLOAD_PNG") {
      lines.push(`Upload PNG: ${proofLabel(item.uploadPngFrame)}`);
    } else {
      lines.push(`Link Canva: ${item.linkCanva || "-"}`);
    }
  } else {
    const referenceCount = Array.isArray(item.referensiFiles) ? item.referensiFiles.length : 0;
    lines.push(`Jumlah aset/referensi: ${referenceCount} file`);
    lines.push(`Deskripsi: ${item.deskripsiFrame || "-"}`);
  }

  lines.push(`Bukti pembayaran: ${proofLabel(item.buktiPembayaran)}`);
  if (duplicateCount > 1) {
    lines.push("");
    lines.push(`Catatan: kode pendek ini cocok dengan ${duplicateCount} request. Pakai kode yang lebih panjang dari ID list jika perlu.`);
  }
  return lines.join("\n");
}

function formatAmbiguousCustomFrameDetail(suffix, matches) {
  const suffixByCode = uniqueSuffixes(matches, suffix.length + 1);
  const lines = [
    `Kode ${suffix} cocok dengan ${matches.length} custom frame.`,
    "Pakai kode yang lebih panjang dari salah satu request ini:",
    "",
    ...matches.slice(0, 10).map((item, index) => {
      const code = customFrameCode(item);
      const shortCode = suffixByCode.get(code) || suffixForCode(code, suffix.length + 1);
      return `${index + 1}. ${formatDateLongID(customFrameDate(item))} ${formatArrivalTime(item.perkiraanJamKedatangan || item.startTime)} - ${
        item.judulFrame || "-"
      }, ${item.namaPemesan || "-"}\nID: ${shortCode}`;
    }),
  ];
  return lines.join("\n");
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

  const items = sortCustomFrames(Array.from(byId.values()));

  return formatCustomFrameList(`Custom Frame Hari Ini - ${formatDateLongID(today)}`, items);
}

export async function listUpcomingCustomFrames() {
  const db = getDb();
  const today = getTodayInTimezone();
  const snap = await db
    .collection(CUSTOM_FRAME_COLLECTION)
    .where("tanggalPemakaian", ">=", today)
    .orderBy("tanggalPemakaian", "asc")
    .limit(10)
    .get();
  const items = sortCustomFrames(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

  return formatCustomFrameList(`Custom Frame Selanjutnya - mulai ${formatDateLongID(today)}`, items);
}

export async function getCustomFrameDetailBySuffix(rawSuffix) {
  const suffix = String(rawSuffix || "").trim().toLowerCase();
  if (suffix.length < 4) return "Kode detail minimal 4 karakter. Contoh: /cf-detail-193a";

  const db = getDb();
  const today = getTodayInTimezone();
  const snap = await db
    .collection(CUSTOM_FRAME_COLLECTION)
    .where("tanggalPemakaian", ">=", today)
    .orderBy("tanggalPemakaian", "asc")
    .limit(CUSTOM_FRAME_LOOKUP_LIMIT)
    .get();
  const matches = sortCustomFrames(
    snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => customFrameCode(item).toLowerCase().endsWith(suffix)),
  );

  if (!matches.length) {
    return `Custom frame dengan kode ${suffix} belum ditemukan di request hari ini dan berikutnya.`;
  }
  if (matches.length > 1) return formatAmbiguousCustomFrameDetail(suffix, matches);
  return formatCustomFrameDetail(matches[0]);
}
