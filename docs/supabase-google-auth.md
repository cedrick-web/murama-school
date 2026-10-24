# Supabase Google sign-in

Murama School uses Supabase Auth to verify the provider identity and Supabase PostgreSQL for application records. The school account/role system remains authoritative: users must already exist in **public.users**, must be active, and the database role attached to that account determines what the school API permits.

## Configure the provider

1. Open the existing **muramaSDMS** project (`ilmvmqxmasgasrtokjmz`) and then **Authentication → Providers → Google**.
2. Configure Google OAuth client credentials as directed by Supabase and enable the provider.
3. In **Authentication → URL Configuration**, add the local frontend URL and the exact production callback/redirect destinations used by the Google sign-in flow. Keep redirect entries restricted to domains owned by the school.
4. Configure the backend environment variables from **backend/.env.example**: **SUPABASE_URL**, **SUPABASE_PUBLISHABLE_KEY**, **SUPABASE_DB_URL**, and **JWT_SECRET**.
5. Configure the frontend variables in **frontend/.env.local**: **VITE_SUPABASE_URL**, **VITE_SUPABASE_PUBLISHABLE_KEY**, and **VITE_API_URL**.

Publishable/anon keys are intended for browser use under proper RLS policies. Never expose the database URI, a Supabase service-role/secret key or **JWT_SECRET** in frontend code.

## Identity-to-school-account flow

1. The browser completes Supabase's OAuth flow and receives a Supabase access token.
2. The backend verifies that token with Supabase Auth rather than trusting a decoded token from the browser.
3. The verified email is matched to an existing school account in **public.users**.
4. Inactive accounts and emails with no matching school account are rejected.
5. The server issues the application's existing JWT using the role found in **public.roles**; role and status claims are not taken from editable Google/Supabase user metadata.

This preserves the current school authorization contract while delegating Google identity verification to Supabase. The flow does not auto-create school accounts or grant roles.

## Database and row-level security

The schema baseline lives in **supabase/migrations/**. School tables have RLS enabled and no blanket grants to browser roles. The server API connects using the backend-only Supabase PostgreSQL connection. **public.profiles** is solely for Supabase Auth identity metadata and has own-row RLS policies; it is not used to decide school roles.

## Verification checklist

- Google sign-in succeeds for an email attached to an existing active school account.
- A verified but unknown email is rejected without creating a school user.
- A matching inactive account is rejected.
- After sign-in, check that the API JWT carries the database role, not a client-supplied role.
- Verify the configured callback in both Supabase and Google OAuth settings.
- Do not treat a successful frontend OAuth redirect as proof of application authorization; test the API response too.