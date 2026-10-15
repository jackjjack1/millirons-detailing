# Deploy (Cloudflare Pages + Functions)
Dashboard zip upload does NOT run Functions. Deploy from this folder with wrangler (Node >= 22):

    export CLOUDFLARE_API_TOKEN=...   # Account > Cloudflare Pages: Edit (+ Workers R2 Storage: Edit if wrangler manages R2)
    export CLOUDFLARE_ACCOUNT_ID=...
    npm ci && npx vite build
    npx wrangler pages secret put STRIPE_SECRET_KEY --project-name millirons-detailing
    npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name millirons-detailing   # optional
    npx wrangler pages deploy dist --project-name millirons-detailing

functions/ is picked up automatically from the project root. R2 binding PHOTOS -> millirons-detailing-media is in wrangler.toml.
Stripe webhook endpoint (optional): https://<domain>/api/stripe-webhook  events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed
Enable Affirm in Stripe Dashboard > Payment methods.

## Accounts and sessions

Sign-in is server-side. Passwords are hashed with PBKDF2-SHA-256 (100,000 iterations and a random salt per account) and never sent back to the browser. A signed-in browser holds an `md_session` cookie: HttpOnly, Path=/, 14 days. On HTTPS the cookie is `SameSite=None; Secure; Partitioned` so a cross-site preview can send it without handing that same cookie to every other website. Plain HTTP `wrangler pages dev` cannot use `SameSite=None` (browsers drop it without `Secure`), so localhost keeps `SameSite=Lax` and omits `Secure`. The signature and HttpOnly flag are still set.

`/api/*` answers credentialed browser calls only for an allowlist in `functions/_lib/cors.js`: `https://millironsdetailing.com`, `https://www.millironsdetailing.com`, `https://millirons-detailing.pages.dev`, `https://<one-label>.millirons-detailing.pages.dev`, and Google AI Studio preview hosts `https://<hash>-h<version>.scf.usercontent.goog`. A matching `Origin` is reflected. `Access-Control-Allow-Credentials: true` is set. `*` is never sent. `POST`, `PUT`, `PATCH`, and `DELETE` must send an allowlisted `Origin` (otherwise 403). `POST /api/stripe-webhook` is exempt because Stripe signs the body and does not send `Origin`. Localhost origins are accepted only when the request itself is to localhost, 127.0.0.1, or ::1.

The browser calls a relative `/api` path on millironsdetailing.com, www, any `*.pages.dev` host, and localhost. On any other host, including an AI Studio preview, it calls `https://millironsdetailing.com` unless `VITE_API_BASE` is an http(s) origin at build time. Every `/api` fetch uses `credentials: 'include'`. Safari, and Chromium with third-party cookies blocked, may still refuse the preview session. The session stays in the HttpOnly cookie and is not copied into `sessionStorage`.

Accounts, sessions, team invites, and employee-invite links are JSON objects in the existing `PHOTOS` bucket (`millirons-detailing-media`), under the private prefix `_auth/`. Nothing in the app serves that prefix. No KV namespace and no D1 database are required.

GitHub Actions does not need new secrets. `deploy.yml` only passes `CLOUDFLARE_API_TOKEN` and the account id. `SESSION_SECRET` and `ADMIN_SETUP_CODE` live on the Pages project. Set them once with wrangler (or in the dashboard under the Pages project → Settings → Variables and secrets). They survive later deploys.

### Secrets to set

| Name | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Yes, before anyone can sign in | HMAC key for the session cookie. At least 32 characters. Changing it signs everyone out. |
| `ADMIN_SETUP_CODE` | Yes, until the first admin exists | One-time code for creating the first admin. After that account exists, the code cannot create another admin. |
| `STRIPE_SECRET_KEY` | Only for live checkout | Unchanged. |
| `STRIPE_WEBHOOK_SECRET` | Optional | Unchanged. |

Generate a different value for each secret. `openssl rand -base64 32` prints 44 characters and is long enough. Do not reuse one value for both secrets.

```bash
openssl rand -base64 32
printf '%s' 'paste-the-session-secret' | npx wrangler pages secret put SESSION_SECRET --project-name millirons-detailing
openssl rand -base64 32
printf '%s' 'paste-the-setup-code' | npx wrangler pages secret put ADMIN_SETUP_CODE --project-name millirons-detailing
```

`printf` is intentional. `echo` adds a newline, and that newline would be part of the secret. The server trims surrounding whitespace, but pasting the exact value avoids a mismatch when you type the setup code into the sign-in page.

### Create the first admin

1. Deploy, with both secrets set.
2. Open `https://<domain>/#/login?role=admin`.
3. When no admin exists yet, the sign-in page asks for name, email, password (8+ characters), and the setup code.
4. Submit. That browser is signed in, and so is any other browser that later uses the same email and password.
5. A browser that does not have the setup code cannot create an admin. After the first admin exists, the create-admin form is gone. `POST /api/auth/setup` returns 403 even if someone still knows the code.

The one-time lock is the R2 object `_auth/meta/bootstrap.lock`. You can delete the `ADMIN_SETUP_CODE` secret after the admin exists:

```bash
npx wrangler pages secret delete ADMIN_SETUP_CODE --project-name millirons-detailing
```

Leave the lock object in place. If you are locked out and need to bootstrap again, delete `_auth/meta/bootstrap.lock` plus that admin’s `_auth/users/<id>` object and the matching `_auth/email/<hash>` pointer in the `millirons-detailing-media` bucket, set `ADMIN_SETUP_CODE` again, and repeat the sign-in steps. Do not delete other `_auth/users/` objects unless you mean to remove those people.

### Who can create which account

- Customers create their own account from the Customer tab → Create account.
- Employees come from Invite employees (a prefilled apply link) or from Team → Invite a team member. Both create a server account. Invite employees still opens the admin’s own mail and messages apps; the site does not send the message.
- Admins cannot be created from the public form. The only ways to add one are the one-time setup code, or an invite from an admin who is already signed in.

### Local wrangler

Put the same two secrets in `.dev.vars` (gitignored) and run Pages locally:

```bash
npm ci && npx vite build
cat > .dev.vars <<'EOF'
SESSION_SECRET=local-only-session-secret-at-least-32-chars
ADMIN_SETUP_CODE=local-only-setup-code
EOF
npx wrangler pages dev dist --port 8788
```

`npm run test:auth` exercises the functions with an in-memory R2 bucket. `node test/live-auth.mjs` builds nothing by itself; run it after `npm run build` to drive `wrangler pages dev` and two Playwright browser contexts.
