function formatRupiah(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount).replace(/\s/g, " ");
}

function formatDateLongID(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return String(value);

  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatSchedule(date, startTime, endTime) {
  const time = [startTime, endTime].filter(Boolean).join("-");
  return [formatDateLongID(date), time].filter(Boolean).join(" ").trim() || "-";
}

function shortCustomFrameId(value) {
  return String(value || "").trim().slice(-4).toLowerCase() || "-";
}

export function buildStudioPhotoResultMessage(delivery) {
  const payload = delivery.payload || {};
  const customerName = String(payload.customerName || "Kak").trim() || "Kak";
  const publicBookingCode = String(payload.publicBookingCode || delivery.sourceId || "-").trim();
  const resultLink = String(payload.resultLink || "").trim();

  return [
    `Halo ${customerName},`,
    "",
    `Hasil foto studio kamu untuk booking ${publicBookingCode} sudah siap ya.`,
    "",
    "Link hasil foto:",
    resultLink,
    "",
    "Silakan cek dan download dari link di atas. Kalau ada kendala membuka link, balas pesan ini supaya tim Waroeng Foto bisa bantu cek.",
  ].join("\n");
}

export function buildBookingSettledGroupMessage(delivery) {
  const payload = delivery.payload || {};
  const code = payload.publicBookingCode || payload.bookingId || delivery.sourceId || "-";
  return [
    "Booking Studio Baru - Payment Verified",
    "",
    `Kode: ${code}`,
    `Customer: ${payload.customerName || "-"}`,
    `WhatsApp: ${payload.customerWhatsapp || "-"}`,
    `Cabang: ${payload.branchName || payload.branchCode || "-"}`,
    `Jadwal: ${formatSchedule(payload.bookingDate, payload.startTime, payload.endTime)}`,
    `Paket: ${payload.productName || "-"}`,
    payload.backgroundName ? `Background: ${payload.backgroundName}` : "",
    `Total: ${formatRupiah(payload.totalPayment || payload.pakasirTotalPayment)}`,
    `Status: ${payload.paymentStatus || "paid"}`,
    "",
    "Cek list booking: /bk today",
  ].filter(Boolean).join("\n");
}

export function buildCustomFrameSubmittedGroupMessage(delivery) {
  const payload = delivery.payload || {};
  const code = payload.publicRequestId || payload.requestId || delivery.sourceId || "";
  const method = payload.metodeEdit === "DIEDIT_WAROENGFOTO" ? "Diedit Waroeng Foto" : "Edit sendiri";
  const express = payload.isExpress ? "Express" : "Bukan Express";

  return [
    "Custom Frame Baru - Payment Submitted",
    "",
    `ID: ${shortCustomFrameId(code)} (${code || "-"})`,
    `Judul: ${payload.judulFrame || "-"}`,
    `Customer: ${payload.namaPemesan || payload.customerName || "-"}`,
    `WhatsApp: ${payload.noWhatsapp || payload.customerWhatsapp || "-"}`,
    `Cabang: ${payload.branchName || payload.branchCode || "-"}`,
    `Tanggal pakai: ${formatSchedule(payload.tanggalPemakaian, payload.perkiraanJamKedatangan, "")}`,
    `Produk: ${payload.productTitle || payload.ukuranFrame || "-"}`,
    `Metode: ${method}, ${express}`,
    `Total: ${formatRupiah(payload.totalPrice)}`,
    "",
    `Detail: /cf-detail-${shortCustomFrameId(code)}`,
  ].join("\n");
}
