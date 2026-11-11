// Sends email through Resend (the delivery service). The API key lives in a
// Vercel environment variable and never appears in the code.

export type Attachment = { filename: string; content: Buffer };

export function emailIsConnected(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(message: {
  from: string;
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  text: string;
  attachments: Attachment[];
}): Promise<{ id: string } | { error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: "Email is not connected yet. Add the Resend key in Vercel first." };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        ...(message.cc.length ? { cc: message.cc } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        subject: message.subject,
        text: message.text,
        attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok || !body.id) return { error: body.message ?? `The email service answered with status ${response.status}.` };
    return { id: body.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The email service could not be reached." };
  }
}
