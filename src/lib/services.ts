// The services Kaizen provides. Each has its own color everywhere it appears.

export type ServiceCategory = "valet" | "trash_room" | "bulk" | "other";

export const SERVICES: Record<ServiceCategory, { label: string; short: string; rgb: string; hex: string }> = {
  valet: { label: "Valet trash", short: "Valet", rgb: "255 75 55", hex: "#FF4B37" }, // Tomato
  trash_room: { label: "Trash room management", short: "Trash room", rgb: "45 108 168", hex: "#2D6CA8" },
  bulk: { label: "Bulk trash", short: "Bulk", rgb: "214 148 30", hex: "#D6941E" },
  other: { label: "Other services", short: "Other", rgb: "100 116 139", hex: "#64748B" },
};

export const SERVICE_ORDER: ServiceCategory[] = ["valet", "trash_room", "bulk", "other"];

export function categoryOfModel(model: string): ServiceCategory {
  if (model === "per_unit_valet") return "valet";
  if (model === "trash_room") return "trash_room";
  if (model === "per_event" || model === "as_needed") return "bulk";
  return "other";
}

export function isServiceCategory(value: string | null | undefined): value is ServiceCategory {
  return value === "valet" || value === "trash_room" || value === "bulk" || value === "other";
}
