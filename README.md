# Visa Filing Portal

Login-based web app for visa filing: admin panel, staff, and customer portal with per-country document
checklists, upload, admin review (accept / reject with reasons) and approval-based document removal.

Live: https://visa-filing-portal.createhub365.workers.dev

- **Hosting:** Cloudflare Worker ([worker/index.js](worker/index.js)) serves `static/` + the `/api` backend.
- **Database:** Supabase PostgreSQL. **Documents:** Supabase Storage (private bucket `documents`).
- No build step, no npm packages.

## Roles

| Role | Can do |
|---|---|
| **Admin** | Everything: staff and customers, **Checklists** (make per country + visa type + salaried/business), document types, review documents (accept / reject with reasons), approve/deny removal requests, edit profiles, reset passwords |
| **Staff** | Dashboard, create customers (not staff), upload documents for customers, request removal, **request a checklist** from the admin |
| **Customer** | Own profile, stage tracker and checklist; upload / re-upload; request removal |

## Checklists

- Admin → **Checklists** → **Make checklist**: country → visa type → applicant (**Salaried person** or
  **Businessman / Self-employed**) → tick documents from the document-type list, or add a custom document
  (custom ones are saved to the list for next time).
- Creating a customer asks for the same three things. If a matching checklist exists, its documents are added
  automatically.
- If none exists, the customer is still created and shows **No checklist created**. Staff (or the customer)
  press **Request admin to create checklist**; it appears under Admin → Checklists → *Checklist requests*.
  When the admin saves that checklist, it is applied to **every waiting customer** with the same
  country + visa type + applicant type.
- Editing a checklist later does not change customers who already have documents; admin can press
  **Apply checklist** on a customer to add any missing documents.

## AI features (Cloudflare Workers AI, free daily allocation)

- **Generate checklist with AI** (Checklists → Make checklist): Llama 3.3 70B suggests documents for the chosen
  country + visa type + applicant, streamed live; each one is matched to the document library (or added to it)
  and dropped into the checklist. Always review before saving.
- **Auto-fetch customer from documents** (+ New customer → Auto-fetch): upload or photograph the passport pages;
  a vision model (Llama 4 Scout, fallback Mistral Small 3.1) reads name, passport no., DOB, expiry, nationality and
  address. Passport no., DOB and expiry are marked **MRZ verified** only when the passport's MRZ check digits match.
  The admin/staff reviews the fields, then the normal customer form opens pre-filled. Photos are not stored.
- **Smart upload** (customer page, above the checklist; admin, staff and customers): select many files (images or PDFs)
  at once. For each file the vision model names the document type and the person on it; the name is compared with the
  customer, the file is uploaded into the matching checklist item, and documents the checklist did not ask for get a
  new custom item. Name mismatches and unreadable files wait for a decision. PDFs are read from page 1 (pdf.js, cdnjs).

## PDF Tools (menu → PDF Tools; all roles)

Image to PDF, Merge PDF, Split PDF (every page / chosen pages / ranges) and PDF to Image (JPG/PNG, ZIP download).
They run entirely in the browser with pdf-lib, pdf.js and JSZip (loaded from cdnjs), so files are not uploaded unless
the user presses **Upload to checklist** on a result. PDF ↔ Word conversion is not included (needs a server-side service).

- Each tool takes files **from the computer/phone** or **from the portal** (documents already in a customer's checklist).
- Results go back into the checklist as: an empty/rejected item, a new custom item, or (admin only) **Replace original**,
  which removes the old file and uploads the new one (it goes to In review).
- Customer page: **Download all as one PDF** merges every uploaded document (PDFs and photos) in checklist order.

## Document flow

`Pending` → upload → `In Review` → admin **Accept** → `Accepted`
                                  ↘ admin **Reject** (reasons) → `Rejected` + reasons shown + **Re-upload** button

**Remove** by customer/staff is never instant: it creates a request, and the document stays (and can't be replaced)
until the admin approves it. On approval the file is deleted from storage and the item goes back to `Pending`.

## Setup (new Supabase project)

In the Supabase **SQL Editor**, run in order:
1. [supabase/schema.sql](supabase/schema.sql): tables, security (RLS on, no public access), `documents` bucket
2. [supabase/002_checklists.sql](supabase/002_checklists.sql): checklist builder tables + starter document types

The first login as `admin` / `admin123` on an empty database creates the admin account. Change the password right away.

## Deploy (Cloudflare Workers Builds from GitHub)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → this repo.
2. Project name `visa-filing-portal` (matches `name` in [wrangler.jsonc](wrangler.jsonc)); build command empty;
   deploy command `npx wrangler deploy`.
3. Worker → **Settings → Variables and Secrets** → add **Secret** `SUPABASE_SECRET_KEY` (Supabase secret key) → Deploy.
4. Every push to `main` redeploys automatically.

`SUPABASE_URL`, `SUPABASE_BUCKET` and `COOKIE_SECURE` are plain vars in `wrangler.jsonc`.
**Never commit the secret key.** It bypasses all database security.

## Data (Supabase)

| Table | Holds |
|---|---|
| `users` | admin, staff, customers (PBKDF2-SHA256, 100k iterations) + profile incl. country, visa type, applicant type |
| `sessions` | login sessions (7 days) |
| `checklist_templates` | admin-made checklists: country + visa type + applicant type → documents |
| `doc_types` | document names to pick from in the builder |
| `checklist_requests` | "please create a checklist" requests to admin |
| `checklist_items` | each customer's required documents, status, file path, reject reasons |
| `removal_requests` | removal requests and admin decisions |
| `activity` | audit log per customer |
| Storage `documents` | uploaded files, path `<customer_id>/<item_id>_<random>.<ext>` |

## Customising

In `worker/index.js`: `REJECT_REASONS`, `STAGES`, `VISA_TYPES`, `APPLICANT_TYPES`. Countries: `COUNTRIES` in `static/app.js`.
