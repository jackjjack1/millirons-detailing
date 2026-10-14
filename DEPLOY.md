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
