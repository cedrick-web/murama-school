# Supabase Google sign-in for Murama School

This is an additive identity integration. Express, MySQL school records and roles, password login, existing JWTs, and administrator APIs remain unchanged.

## Flow and access policy

The /admin Google button starts Supabase OAuth with authorization code + PKCE. Supabase Auth handles the OAuth state check and the client uses a PKCE code verifier to exchange the one-time authorization code, then sends the short-lived access token to Express. Express validates it remotely through Supabase Auth, requires Google as the identity provider and a verified email, looks for an existing active MySQL user, and then issues the existing Murama JWT using the role already assigned in MySQL.

Google never creates school accounts and never grants a role. New or inactive users must be provisioned/reactivated by an administrator. Existing role-protected APIs remain authoritative. public.profiles stores optional supplementary profile fields under owner-only RLS; it is not used to authorize school actions.

## 1. Configure Supabase and Google

1. Open or create a Supabase project.
2. In Authentication > Providers > Google, enable Google and enter the Google OAuth client ID and secret.
3. In Google Cloud Console, create a Web application OAuth client. Add the callback URL shown by Supabase, normally https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback, as the Google authorized redirect URI.
4. In Supabase Authentication > URL Configuration, allow http://localhost:5173/admin and the actual production callback, such as https://YOUR_PRODUCTION_HOST/admin.
5. Apply supabase/migrations/20261024000000_profiles.sql with the Supabase SQL Editor or CLI. Check that profiles is accessible through the Data API if profile syncing is desired.

Never place the Google client secret, Supabase secret key, or service-role key in frontend code or Git.

## 2. Configure local settings

Copy frontend/.env.example to frontend/.env.local and set real values:

    VITE_API_URL=http://localhost:5000
    VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY

Add the following to backend/.env:

    SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
    SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY

The backend also supports SUPABASE_ANON_KEY as an alias. Keep the existing DB variables and strong JWT_SECRET. Do not use a service-role key for this flow. Restart Vite after changing environment values.

## 3. Run and verify

In two PowerShell terminals:

    cd backend
    npm install
    npm run typecheck
    npm run dev

    cd frontend
    npm install
    npm run build
    npm run dev

Open http://localhost:5173/admin. Verify that an active admin with a verified Google email can sign in; missing and inactive users are denied; non-admins cannot access admin APIs; existing email/password login still works; and the profile RLS rules prevent access to another user's row.

For production, use HTTPS and update the frontend API URL, Express CORS origin, Supabase redirect allow list, and hosting environment variables. The current rate limiter is process-local, limited to this endpoint, and capped to bound memory; use a shared limiter store if you run multiple API instances and configure proxy trust carefully for your host. Profile sync is best-effort and will not block valid login if the profile migration is not applied. Existing school records are not migrated to Supabase by this change.
