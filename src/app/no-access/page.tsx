import { signOut } from "../login/actions";

export default function NoAccessPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-xl font-bold text-slate-900">No access</h1>
      <p className="mt-2 text-slate-600">This account does not have access to Kaizen Billing.</p>
      <form action={signOut} className="mt-6">
        <button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">Sign out</button>
      </form>
    </main>
  );
}
