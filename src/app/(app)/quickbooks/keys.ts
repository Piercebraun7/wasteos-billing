export const SERVICE_KEYS = ["valet", "trash_room", "bulk", "other"] as const;
export const SERVICE_LABELS: Record<(typeof SERVICE_KEYS)[number], string> = {
  valet: "Valet trash",
  trash_room: "Trash room management",
  bulk: "Bulk pickups",
  other: "Everything else",
};
