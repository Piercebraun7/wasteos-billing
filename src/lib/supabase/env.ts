// Reads the two Supabase settings from the hosting environment (Vercel).
// Neither value is a secret: both are designed to be visible to the browser.
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Add both in Vercel: Project Settings, Environment Variables.",
    );
  }
  return { url, key };
}

export const ADMIN_ROLE = "billing_admin";
