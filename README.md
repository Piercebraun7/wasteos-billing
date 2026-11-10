# Kaizen Billing

Billing and accounts receivable app for Kaizen Waste, LLC. Next.js on Vercel, Supabase for the database and sign-in.

Settings required in Vercel (Project Settings, Environment Variables):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Only users whose Supabase `app_metadata.role` is `billing_admin` can sign in.
