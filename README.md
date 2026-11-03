# Visa Filing Portal

Login-based web app for visa filing: admin panel, staff, and customer portal with document checklist,
upload, admin review (accept / reject with reasons) and approval-based document removal.

- **Production:** Cloudflare Worker ([worker/index.js](worker/index.js)) serving `static/` + the `/api` backend.
- **Local:** Python 3.9+ server ([app.py](app.py)), standard library only. Same API, same database.
- **Database:** Supabase PostgreSQL. **Documents:** Supabase Storage (private bucket `documents`).

When you change backend behaviour, change it in **both** `worker/index.js` and `app.py`.

## Deploy to Cloudflare (Workers Builds from GitHub)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick this GitHub repo.
2. Project name: `visa-filing-portal` (must match `name` in [wrangler.jsonc](wrangler.jsonc)).
   Build command: *(empty)* · Deploy command: `npx wrangler deploy` · Root directory: `/`.
3. After the first deploy: Worker → **Settings → Variables and Secrets** → **Add** → type **Secret**,
   name `SUPABASE_SECRET_KEY`, value = Supabase secret key → **Deploy**.
4. Every push to `main` redeploys automatically.

`SUPABASE_URL`, `SUPABASE_BUCKET` and `COOKIE_SECURE` are plain vars in `wrangler.jsonc`.

Passwords use PBKDF2-SHA256 with 100,000 iterations (the Workers limit). Accounts created before this format
(`salt$hash`) can't log in on Cloudflare until the admin resets their password, or they log in once on the local app.

## Setup (once per Supabase project)

1. Supabase dashboard → your project → **SQL Editor** → paste and run [supabase/schema.sql](supabase/schema.sql).
   It creates the tables, locks them down (RLS on, no public access) and creates the private `documents` bucket.
2. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`: Project Settings → Data API → Project URL
   - `SUPABASE_SECRET_KEY`: Project Settings → API Keys → Secret key (`sb_secret_...`) or legacy `service_role` key

   **Never share `.env` or put the secret key in frontend code.** It bypasses all security rules.

## Run

```
python app.py
```

Open http://localhost:8000. On first start the app creates `admin` / `admin123`. Change it via *Change password*.

## Roles

| Role | Can do |
|---|---|
| **Admin** | Create staff/customers (ID + password), set profile (name, passport no., visa type, country, stage), manage checklist (templates or custom items), review documents (accept / reject with preset + custom reasons), approve/deny removal requests, remove directly, disable accounts, reset passwords |
| **Staff** | Own dashboard (counts + customers needing re-upload), create customers (not staff), see all customers, upload documents for them, request removal |
| **Customer** | See own profile, stage tracker and checklist; upload / re-upload; request removal |

## Document flow

`Pending` → upload → `In Review` → admin **Accept** → `Accepted`
                                  ↘ admin **Reject** (reasons) → `Rejected` + reasons shown + **Re-upload** button

**Remove** by customer/staff is never instant: it creates a request, and the document stays (and can't be replaced)
until the admin approves it. On approval the file is deleted from storage and the item goes back to `Pending`.

## Where data lives (Supabase)

| Table | Holds |
|---|---|
| `users` | admin, staff, customers (passwords hashed with PBKDF2) + customer profile |
| `sessions` | login sessions |
| `checklist_items` | each required document, its status, file path, reject reasons |
| `removal_requests` | removal requests and admin decisions |
| `activity` | audit log per customer |
| Storage `documents` | uploaded files, path `<customer_id>/<item_id>_<random>.<ext>` |

Backups: Supabase takes daily database backups on paid plans. On the free plan, download a backup from
Database → Backups, or export tables regularly.

## Customising

In `app.py`: `REJECT_REASONS`, `STAGES`, `CHECKLIST_TEMPLATES` (lists at the top of the file).

## Going live

- Run behind HTTPS (e.g. Nginx/Caddy reverse proxy) and set `COOKIE_SECURE=1` in `.env`.
- Change the admin password immediately.
- For users in India, a Supabase project in **Mumbai (ap-south-1)** is faster. Run the same `schema.sql` there and change `.env`.
