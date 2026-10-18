import assert from "node:assert/strict";
import test from "node:test";

import { buildCustomFrameRecapMessage, buildCustomFrameSubmittedGroupMessage } from "../src/formatters.js";

test("pesan Custom Frame mengutamakan kode publik dan tetap memakai ID internal untuk source", () => {
  const delivery = {
    sourceId: "very-long-firestore-document-id",
    payload: {
      requestId: "very-long-firestore-document-id",
      publicRequestCode: "CF-7K2PMX",
      namaPemesan: "Dicky",
      paymentStatus: "paid",
    },
  };
  const group = buildCustomFrameSubmittedGroupMessage(delivery);
  const recap = buildCustomFrameRecapMessage(delivery);
  assert.match(group, /Kode: CF-7K2PMX/);
  assert.match(recap, /Kode: CF-7K2PMX/);
  assert.doesNotMatch(group, /very-long-firestore-document-id/);
  assert.doesNotMatch(recap, /very-long-firestore-document-id/);
});
