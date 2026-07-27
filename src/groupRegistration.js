export const AUTO_GROUP_ROUTES = [
  { routeKey: "booking_settled", label: "Booking Studio" },
  { routeKey: "custom_frame_submitted", label: "Custom Frame" },
];

export function fallbackGroupChat(chatId, message = {}) {
  if (!String(chatId || "").endsWith("@g.us")) return null;

  return {
    isGroup: true,
    id: { _serialized: chatId },
    name: message._data?.chatName || message._data?.notifyName || "",
    participants: null,
  };
}

export function buildGroupRegistrationWrites({ groupId, groupName, participantCount }, now) {
  const groupData = {
    groupId,
    groupName,
    participantCount,
    isRegistered: true,
    lastCommand: "/register",
    lastSeenAt: now,
    updatedAt: now,
    createdAt: now,
  };

  const routeWrites = AUTO_GROUP_ROUTES.map((route) => ({
    routeKey: route.routeKey,
    data: {
      routeKey: route.routeKey,
      targetType: "group",
      enabled: true,
      groupId,
      groupName,
      updatedBy: "/register",
      updatedAt: now,
    },
  }));

  return { groupData, routeWrites };
}
