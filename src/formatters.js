export function buildStudioPhotoResultMessage(delivery) {
  const payload = delivery.payload || {};
  const customerName = String(payload.customerName || "Customer").trim() || "Customer";
  const publicBookingCode = String(payload.publicBookingCode || delivery.sourceId || "-").trim();
  const resultLink = String(payload.resultLink || "").trim();

  return [
    `Halo ${customerName},`,
    "",
    `Hasil foto kamu untuk booking ${publicBookingCode} sudah siap.`,
    "",
    "Link hasil foto:",
    resultLink,
    "",
    "Link berlaku sesuai ketentuan Waroeng Foto. Kalau ada kendala membuka link, balas pesan ini ya.",
  ].join("\n");
}

