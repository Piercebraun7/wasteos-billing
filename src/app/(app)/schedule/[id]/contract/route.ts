import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

/** Sends the signed contract through a link that expires after one minute. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const { data } = await supabase
    .from("contracts")
    .select("contract_file_path, contract_file_name, created_at")
    .eq("account_id", id)
    .not("contract_file_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.contract_file_path) return new NextResponse("No contract has been uploaded for this property.", { status: 404 });
  const signed = await supabase.storage
    .from("contracts")
    .createSignedUrl(data.contract_file_path, 60, { download: data.contract_file_name ?? "Contract.pdf" });
  if (!signed.data?.signedUrl) return new NextResponse("The contract file could not be found.", { status: 404 });
  return NextResponse.redirect(signed.data.signedUrl);
}
