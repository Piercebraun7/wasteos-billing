/** Shown the instant a link is clicked, while the page's data loads. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div>
        <div className="h-3 w-24 rounded bg-slate-200" />
        <div className="mt-3 h-9 w-72 rounded-lg bg-slate-200" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-slate-200" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-28 rounded-3xl bg-slate-200/80" />
        <div className="h-28 rounded-3xl bg-slate-200/60" />
        <div className="h-28 rounded-3xl bg-slate-200/60" />
      </div>
      <div className="h-72 rounded-3xl bg-slate-200/50" />
    </div>
  );
}
