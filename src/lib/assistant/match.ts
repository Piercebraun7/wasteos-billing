/** Finds which property a typed name means. Exact wins; otherwise every word typed must appear in the name. */
export function matchProperty<T extends { name: string }>(typed: string, all: T[]): { match: T | null; candidates: T[] } {
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const want = plain(typed);
  if (!want) return { match: null, candidates: [] };
  const exact = all.filter((a) => plain(a.name) === want);
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  const words = want.split(" ").filter((w) => !["the", "at", "village"].includes(w) || want.split(" ").length === 1);
  const candidates = all.filter((a) => (words.length ? words : want.split(" ")).every((w) => plain(a.name).split(" ").some((part) => part.startsWith(w))));
  return { match: candidates.length === 1 ? candidates[0] : null, candidates };
}
