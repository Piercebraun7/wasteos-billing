"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { sendEmail } from "@/lib/email/resend";

/** Sends a test email to the person signed in, exactly the way an invoice email would go out. */
export async function sendTestEmail() {
  const { supabase, user } = await requireAdmin();
  const done = (kind: "saved" | "error", message: string): never => redirect(`/settings?${kind}=${encodeURIComponent(message)}`);
  if (!user.email) done("error", "Your sign-in has no email address to send the test to.");
  const { data: settings } = await supabase.from("app_settings").select("email_sender, email_reply_to").maybeSingle();
  const from = settings?.email_sender ?? "Kaizen Waste <no-reply@msg.kaizen-waste.com>";
  const sent = await sendEmail({
    from,
    to: [user.email!],
    cc: [],
    replyTo: settings?.email_reply_to ?? null,
    subject: "Test email from the Kaizen billing app",
    text: [
      "This is a test from the Kaizen billing app.",
      "",
      `It was sent from ${from}, the same way invoice emails will go out.`,
      settings?.email_reply_to ? `Reply to this message to check that replies arrive at ${settings.email_reply_to}.` : "",
    ].join("\n"),
    attachments: [],
  });
  if ("error" in sent) done("error", `The test did not send: ${sent.error}`);
  done("saved", `Test sent to ${user.email}. Check your inbox, then reply to it to test the replies inbox.`);
}
