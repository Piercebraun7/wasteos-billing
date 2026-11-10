import { Wordmark } from "@/components/ui";
import { signOut } from "../login/actions";

export default function NoAccessPage() {
  return (
    <main className="relative flex min-h-screen flex-1 flex-col items-center justify-center overflow-hidden bg-night px-4 text-center text-white">
      <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative">
        <div className="flex justify-center"><Wordmark light /></div>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">No access</h1>
        <p className="mt-3 text-white/55">This account does not have access to Kaizen Billing.</p>
        <form action={signOut} className="mt-8">
          <button className="h-11 rounded-full border border-white/15 px-6 text-sm font-medium text-white/85 transition hover:bg-white/10">Sign out</button>
        </form>
      </div>
    </main>
  );
}
