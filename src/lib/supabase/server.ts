import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ADMIN_ROLE, supabaseEnv } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a server component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** The parts of a signed-in person the app uses, read from their verified sign-in token. */
export type SignedInUser = {
  id: string;
  email: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
};

/**
 * Who is signed in, or null. The sign-in token's signature is verified, which
 * for most requests needs no round trip to the sign-in server.
 */
export async function currentUser(supabase: Awaited<ReturnType<typeof createClient>>): Promise<SignedInUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    app_metadata: (claims.app_metadata ?? {}) as Record<string, unknown>,
    user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown>,
  };
}

// app_metadata can only be set with the Supabase service key, never by the
// signed-in user, so it is safe to use for the admin check.
export function isBillingAdmin(user: { app_metadata?: Record<string, unknown> } | null): boolean {
  return user?.app_metadata?.role === ADMIN_ROLE;
}
