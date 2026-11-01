# Jewellery management system

Django REST API (`backend/`) + a new React app (`frontend/`).

## Run it

```bash
# 1. backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser                        # an email is needed: you sign in with it
python manage.py runserver                              # http://127.0.0.1:8000

# optional: sample customers, orders, bills (login demo@example.com / demo12345)
python manage.py seed_demo

# 2. frontend (new terminal)
cd frontend
npm install
npm run dev                                             # http://localhost:5173
```

The dev server proxies `/api` and `/media` to Django, so there is nothing to configure.
Copy `backend/.env.example` to `backend/.env` to change the shop name, time zone, e-mail or secret key.
Every screen is explained in [docs/UI-GUIDE.md](docs/UI-GUIDE.md). The app has a **Products** catalog and an
**English / العربية** switch (right-to-left).

## Put it online with Supabase

Supabase is used as the cloud **database** (Postgres) and **photo storage**. Django still runs the logic, so
it needs a small host for Python (Render's free plan works). The website itself is static (Vercel or Netlify).
Nothing in your code changes between local and online; only environment variables do.

1. **Supabase project**: create one at supabase.com. Remember the database password.
2. **Database**: Project Settings > Database > Connection string > *Session pooler* (works on IPv4). Copy it
   as `DATABASE_URL` (replace `[YOUR-PASSWORD]`). Do not use the "transaction" string unless you also set `DB_POOLED=1`.
3. **Photos**: Storage > New bucket, name `photos`, tick *Public bucket*. Then Project Settings > Storage > S3 Connection:
   create an access key. You need: endpoint (`https://<ref>.supabase.co/storage/v1/s3`), key id, secret and region.
   Set `SUPABASE_S3_BUCKET=photos`, `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_ACCESS_KEY`, `SUPABASE_S3_SECRET_KEY`,
   `SUPABASE_S3_REGION`, and `SUPABASE_PUBLIC_URL_HOST=<ref>.supabase.co/storage/v1/object/public/photos`.
4. **API host (Render)**: push this folder to GitHub, then Render > New > Blueprint (it reads `render.yaml`).
   Fill the variables it asks for. Set `DJANGO_ALLOWED_HOSTS` to your Render hostname if it is not `*.onrender.com`,
   `CORS_ORIGINS` and `CSRF_TRUSTED_ORIGINS` to your website address (e.g. `https://gitanjali.vercel.app`),
   `FRONTEND_URL` the same. On start it runs `migrate`, so the tables are created in Supabase automatically.
   Create your login once from Render's shell: `python manage.py createsuperuser`.
5. **Website (Vercel/Netlify)**: root `frontend`, build `npm run build`, output `dist`.
   Set `VITE_API_URL=https://<your-render-service>.onrender.com/api`. `vercel.json` and `public/_redirects` make page refreshes work.

**Security.** Supabase publishes every table of the `public` schema through its own REST API. After every `migrate`
this project turns on Row Level Security for all tables (and revokes the `anon`/`authenticated` roles), so only Django,
signed in as the database owner, can read them. Keep `DATABASE_URL`, the S3 secret and the service key private;
never put them in the frontend. Set `SUPABASE_LOCKDOWN=0` only if you know why.

**Good to know.** Free Supabase projects pause after a week without use (press Restore in the dashboard). Render's free
plan sleeps when idle, so the first request can take about 30 seconds. Back up with Supabase's backups or `pg_dump`.
To move existing local data: `python manage.py dumpdata --exclude contenttypes --exclude auth.permission > data.json`,
then with `DATABASE_URL` set: `migrate`, `loaddata data.json`.

## If you already have a database

The zip you sent had no `migrations/` folder or `settings.py`, so this project ships a fresh
`main/migrations/0001_initial.py` and a new `config/` project. For an **existing** database:
keep your own `main/migrations/`, copy over the new `models.py`, run `python manage.py makemigrations main`
then `migrate`. The model changes are small: `phone`/`pan_number` on the user become text (they were
floats, so old values may read `9841234567.0` and need a clean-up), `address` may be blank, an order's
due date may be empty, a few `related_name`s were renamed, and `Rate.date` now defaults to the current day.

## What was fixed in the backend

| Problem | Fix |
|---|---|
| `from asyncio.windows_events import NULL` / `from turtle import mode` crashed on Linux | Removed |
| Most endpoints had no login check | Every endpoint needs a JWT unless it is login / password reset |
| Admin profile was hard-coded to user id 1 | Uses the signed-in user |
| Customers were matched by name only (two people called "Hari" merged) | Matched by id, else by phone; otherwise a new customer |
| Bill totals came from the browser | Server recomputes every line, total, discount, balance (`main/calc.py`) |
| QR code used a guessed invoice number and was regenerated on every save | Made after the bill has its real id; refreshed when amounts change |
| `Rate.date` default was frozen at server start; `updateTodaysRate` used `datetime.date.today()` on the class | Callable default; one rate per day with `update_or_create` |
| Increment report crashed in January; weekly report added a duplicate week | Rewritten with real month/week maths |
| Sales report crashed on bills with empty amounts | Null-safe |
| Order/bill search crashed when a filter was missing (`NameError`, `None != ''`) | Every filter is optional |
| `getRateReport` returned nothing for an unknown type | 400 with a message |
| Failed saves could leave half-created orders | Every multi-table write is one transaction |
| E-mail settings read from `mail.json` at import (crash if missing) | Normal Django settings; an e-mail failure never blocks work |
| Staff: update was dead code, error response used the wrong attribute | Working endpoints with clear rules |
| Django admin stored user passwords in plain text | Uses `UserAdmin` |

## New / completed endpoints

`dashboard/summary/` (one call for the Today screen) · `customers/` create + search · `customer/<id>` edit and delete ·
`order/<id>/status/` · `order-product/<id>/design/` (photo upload) · `bill/<id>/payment/` (record a later payment) ·
`rate/latest/` · `staff/work/<id>/submit/` (receive finished work, loss worked out) · `staff/work/<id>` (take work back) ·
`staff-update/<id>` · password reset now links to `/reset-password?token=…` in the new app.

Business rules enforced by the server: an item can only be given to one craftsman; resigned staff cannot get work;
an order can only be deleted while it is new and has no bill; an order cannot get two submitted bills; deleting a bill
puts its order back to "Ready"; a customer or craftsman with history cannot be deleted; payments cannot exceed the balance.

Request shapes changed (the old nested-customer payloads are gone): see `main/serializers.py` (`OrderPayload`, `BillPayload`).
Removed dead endpoints: `generate-order-bill/`, `rate-update/<id>`, `orders-list/`, `bills-list/`.

## Tests

```bash
cd backend && python manage.py test        # 38 tests: maths, lifecycle, rules, permissions
```

## The new interface

* **Rate bar** on every screen: today's Hallmark, Tajabi and silver rate; it warns when they were not set today.
* **Today**: what is late, ready for pickup, with craftsmen and unpaid, plus sales and top items.
* **Orders** → one-screen form, progress steps, give work to a craftsman, make the bill from the order.
* **Bills**: live totals while typing, balance box, printable invoice with QR, record a later payment.
* **Customers**, **Craftsmen** (work and people), **Rates** (chart + history), **Settings**.
* Works on a phone (menu drawer, stacked forms). Errors stay on screen until closed.
