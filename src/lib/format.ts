const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01-05" -> "Jan 5, 2026". Works on the text directly, so no time zone can shift the day. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export const BILLING_MODELS: Record<string, string> = {
  per_unit_valet: "Per-unit valet",
  flat_monthly: "Flat monthly amount",
  per_event: "Per event (moves, bulk pickups)",
  as_needed: "As needed (events only)",
  trash_room: "Trash room management",
};

export const EVENT_TYPES: Record<string, string> = {
  dumpster_move: "Dumpster move",
  bulk_pickup: "Bulk pickup",
  trash_room_visit: "Trash room visit",
  as_needed: "As-needed job",
  other: "Other",
  resident_refund: "Resident refund",
};

/** Models billed from monthly phases. The others are billed from events only. */
export function usesPhases(model: string): boolean {
  return model === "per_unit_valet" || model === "flat_monthly" || model === "trash_room";
}
