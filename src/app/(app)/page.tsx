import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const instant = false;

export default async function DashboardPage() {
  const { name } = await requireAdmin();
  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-slate-600">Signed in as {name}.</p>
      <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        Totals, aging, and exceptions will appear here once invoices exist. For now, start in{" "}
        <Link href="/accounts" className="font-medium text-slate-900 underline">Accounts</Link>.
      </div>
    </>
  );
}
