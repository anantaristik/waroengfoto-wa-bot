import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupRegistrationWrites, fallbackGroupChat } from "../src/groupRegistration.js";

test("/register writes default notification routes for the group", () => {
  const now = { sentinel: "serverTimestamp" };
  const result = buildGroupRegistrationWrites(
    {
      groupId: "120363000000000000@g.us",
      groupName: "WF Ops",
      participantCount: 12,
    },
    now,
  );

  assert.equal(result.groupData.groupId, "120363000000000000@g.us");
  assert.equal(result.groupData.isRegistered, true);
  assert.equal(result.groupData.lastCommand, "/register");

  const routes = new Map(result.routeWrites.map((route) => [route.routeKey, route.data]));
  assert.deepEqual([...routes.keys()].sort(), ["booking_settled", "custom_frame_submitted"]);
  assert.equal(routes.get("custom_frame_submitted").enabled, true);
  assert.equal(routes.get("custom_frame_submitted").groupId, "120363000000000000@g.us");
  assert.equal(routes.get("custom_frame_submitted").updatedBy, "/register");
  assert.equal(routes.get("booking_settled").groupId, "120363000000000000@g.us");
});

test("/register can fall back to message group id when WhatsApp chat lookup fails", () => {
  const chat = fallbackGroupChat("120363111111111111@g.us", {
    _data: { chatName: "CUSTOM FRAME", notifyName: "Ananta" },
  });

  assert.equal(chat.isGroup, true);
  assert.equal(chat.id._serialized, "120363111111111111@g.us");
  assert.equal(chat.name, "CUSTOM FRAME");
});

test("/register fallback does not use sender notify name as group name", () => {
  const chat = fallbackGroupChat("120363222222222222@g.us", {
    _data: { notifyName: "Ananta" },
  });

  assert.equal(chat.name, "");
});
