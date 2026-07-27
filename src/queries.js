import { getDb } from "./firebase.js";
import { formatDateLongID, getTodayInTimezone } from "./time.js";

const BOOKING_COLLECTION = "studio_bookings";
const CUSTOM_FRAME_COLLECTION = "custom_frame_requests";
const BOOKING_LOOKUP_LIMIT = 250;
const CUSTOM_FRAME_LOOKUP_LIMIT = 250;

function formatTimeRange(item) {
  return [item.startTime, item.endTime].filter(Boolean).join("-") || "-";
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

function bookingCode(item) {
  return String(item.publicBookingCode || item.bookingId || item.id || "").trim();
}

function suffixForCode(code, length) {
  return String(code || "").replace(/\s/g, "").slice(-length).toLowerCase();
}

function uniqueSuffixes(items, minLength = 4, getCode = customFrameCode) {
  const codes = items.map(getCode);
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

function bookingDate(item) {
  return item.bookingDate || item.date || "";
}

function bookingStatus(item) {
  return normalizeStatus(item.bookingStatus || item.status);
}

function paymentStatus(item) {
  return normalizeStatus(item.paymentStatus || item.payment_status);
}

function bookingCustomerWhatsapp(item) {
  return item.customerWhatsapp || item.whatsapp || item.phone || item.phoneNumber || "-";
}

function bookingTotal(item) {
  return item.totalPayment || item.pakasirTotalPayment || item.amount || item.total || item.totalPrice || 0;
}

function compactBookingLine(item, index, suffixByCode) {
  const code = bookingCode(item);
  const shortCode = suffixByCode?.get(code) || suffixForCode(code, 4) || "-";
  const customer = item.customerName || item.name || "-";
  const branch = item.branchCode || item.branchName || item.branchId || "-";
  const product = item.productName || item.packageName || item.productId || "-";
  const status = [bookingStatus(item), paymentStatus(item)].filter((value) => value && value !== "-").join(" / ");

  return [
    `${index + 1}. [${shortCode}] ${code || "-"}`,
    `   Customer: ${customer}`,
    `   Cabang: ${branch}`,
    `   Jadwal: ${formatDateLongID(bookingDate(item))}, ${formatTimeRange(item)}`,
    `   Paket: ${product}`,
    item.backgroundName ? `   Background: ${item.backgroundName}` : "",
    `   Status: ${status || "-"}`,
    `   Detail: /bk-detail-${shortCode}`,
  ].filter(Boolean).join("\n");
}

function formatBookingList(title, items) {
  if (!items.length) return `${title}\n\nBelum ada booking studio.`;
  const suffixByCode = uniqueSuffixes(items, 4, bookingCode);
  return [`*${title}*`, `Total: ${items.length} booking`, "", ...items.map((item, index) => compactBookingLine(item, index, suffixByCode))].join("\n\n");
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

function sortBookings(items) {
  return items.sort((a, b) => {
    const dateDiff = String(bookingDate(a)).localeCompare(String(bookingDate(b)));
    if (dateDiff) return dateDiff;
    return String(a.startTime || "").localeCompare(String(b.startTime || ""));
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

function formatBookingDetail(item, duplicateCount = 0) {
  const code = bookingCode(item) || item.id || "-";
  const lines = [
    `ID Booking: ${code}`,
    "",
    "DATA CUSTOMER",
    `Nama: ${item.customerName || item.name || "-"}`,
    `WhatsApp: ${bookingCustomerWhatsapp(item)}`,
    item.customerEmail || item.email ? `Email: ${item.customerEmail || item.email}` : "",
    "",
    "DETAIL BOOKING",
    `Cabang: ${item.branchName || item.branchCode || item.branchId || "-"}`,
    `Paket: ${item.productName || item.packageName || item.productId || "-"}`,
    item.backgroundName ? `Background: ${item.backgroundName}` : "",
    `Tanggal booking: ${formatDateLongID(bookingDate(item))}`,
    `Jam: ${formatTimeRange(item)}`,
    `Status booking: ${bookingStatus(item)}`,
    `Status payment: ${paymentStatus(item)}`,
    "",
    "RINCIAN PEMBAYARAN",
    `Total: ${formatRupiah(bookingTotal(item))}`,
    item.paymentMethod ? `Metode: ${item.paymentMethod}` : "",
    item.pakasirTransactionId || item.transactionId ? `Ref payment: ${item.pakasirTransactionId || item.transactionId}` : "",
  ].filter(Boolean);

  const resultLink = item.photoResultDriveLink || item.resultLink || "";
  if (resultLink || item.photoResultWhatsappStatus || item.photoResultStatus) {
    lines.push("");
    lines.push("HASIL FOTO");
    if (resultLink) lines.push(`Link Drive: ${resultLink}`);
    lines.push(`Status WA: ${item.photoResultWhatsappStatus || "-"}`);
    lines.push(`Status hasil: ${item.photoResultStatus || "-"}`);
  }

  if (duplicateCount > 1) {
    lines.push("");
    lines.push(`Catatan: kode pendek ini cocok dengan ${duplicateCount} booking. Pakai kode yang lebih panjang dari ID list jika perlu.`);
  }
  return lines.join("\n");
}

function formatAmbiguousBookingDetail(suffix, matches) {
  const suffixByCode = uniqueSuffixes(matches, suffix.length + 1, bookingCode);
  const lines = [
    `Kode ${suffix} cocok dengan ${matches.length} booking.`,
    "Pakai kode yang lebih panjang dari salah satu booking ini:",
    "",
    ...matches.slice(0, 10).map((item, index) => {
      const code = bookingCode(item);
      const shortCode = suffixByCode.get(code) || suffixForCode(code, suffix.length + 1);
      return `${index + 1}. ${formatDateLongID(bookingDate(item))} ${formatTimeRange(item)} - ${
        item.customerName || "-"
      }, ${item.productName || item.packageName || "-"}\nID: ${shortCode}`;
    }),
  ];
  return lines.join("\n");
}

export async function listTodayBookings() {
  const today = getTodayInTimezone();
  return listBookingsByDate(today, `Booking Studio Hari Ini - ${formatDateLongID(today)}`);
}

export async function listBookingsByDate(date, title = `Booking Studio - ${formatDateLongID(date)}`) {
  const db = getDb();
  const snap = await db
    .collection(BOOKING_COLLECTION)
    .where("bookingDate", "==", date)
    .limit(20)
    .get();
  const items = sortBookings(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

  return formatBookingList(title, items);
}

export async function listUpcomingBookings() {
  const db = getDb();
  const today = getTodayInTimezone();
  const snap = await db
    .collection(BOOKING_COLLECTION)
    .where("bookingDate", ">=", today)
    .orderBy("bookingDate", "asc")
    .limit(10)
    .get();
  const items = sortBookings(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

  return formatBookingList(`Booking Studio Selanjutnya - mulai ${formatDateLongID(today)}`, items);
}

export async function listTodayCustomFrames() {
  const today = getTodayInTimezone();
  return listCustomFramesByDate(today, `Custom Frame Hari Ini - ${formatDateLongID(today)}`);
}

export async function listCustomFramesByDate(date, title = `Custom Frame - ${formatDateLongID(date)}`) {
  const db = getDb();
  const fields = ["tanggalPemakaian", "bookingDate", "date"];
  const byId = new Map();

  for (const field of fields) {
    const snap = await db.collection(CUSTOM_FRAME_COLLECTION).where(field, "==", date).limit(20).get();
    snap.docs.forEach((doc) => byId.set(doc.id, { id: doc.id, ...doc.data() }));
  }

  const items = sortCustomFrames(Array.from(byId.values()));

  return formatCustomFrameList(title, items);
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

export async function getBookingDetailBySuffix(rawSuffix) {
  const suffix = String(rawSuffix || "").trim().toLowerCase();
  if (suffix.length < 4) return "Kode detail minimal 4 karakter. Contoh: /bk-detail-a1b2";

  const db = getDb();
  const today = getTodayInTimezone();
  const snap = await db
    .collection(BOOKING_COLLECTION)
    .where("bookingDate", ">=", today)
    .orderBy("bookingDate", "asc")
    .limit(BOOKING_LOOKUP_LIMIT)
    .get();
  const matches = sortBookings(
    snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => bookingCode(item).toLowerCase().endsWith(suffix)),
  );

  if (!matches.length) {
    return `Booking dengan kode ${suffix} belum ditemukan di booking hari ini dan berikutnya.`;
  }
  if (matches.length > 1) return formatAmbiguousBookingDetail(suffix, matches);
  return formatBookingDetail(matches[0]);
}
