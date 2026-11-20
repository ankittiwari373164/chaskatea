# ChaskaTea Store

A complete e-commerce site for ChaskaTea: storefront, customer accounts and dashboard, admin panel,
Cash on Delivery, Razorpay and Shiprocket. One Node.js app, no build step, **no npm packages to install**.

## Run it (2 minutes)

```bash
node server.js          # needs Node.js 18 or newer
# open http://localhost:3000
```

The first start creates the database and loads the 14 ChaskaTea products.

| Environment variable | What it does | Default |
|---|---|---|
| `PORT` | port to listen on | 3000 |
| `DATA_DIR` | where the database, secret key and uploaded photos live. **Back this folder up.** | `~/chaskatea-data` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first admin account (only used on the very first start) | `admin@chaskatea.com` / `Chaska@2026!` (must be changed at first login) |

## Admin panel — `/admin`

Sign in with the admin login above. On first sign-in you are forced to choose a new password.

* **Dashboard** – sales, orders by status, low stock, top sellers
* **Orders** – search/filter, change status (customer sees it in their timeline), mark COD collected, refund, create Shiprocket shipment, refresh tracking, print label
* **Products** – add/edit/hide, price, MRP, online-payment discount per pack, stock, photos (upload), categories
* **Coupons** – % or flat, min order, max discount, usage limits, per-customer limit, online-only / COD-only, expiry
* **Offers & banners** – home banners, top announcement strip, automatic discounts (no code needed)
* **Payments** – paid online / COD to collect / collected / refunded, transaction log
* **Customers**, **Messages** (contact form inbox)
* **Settings** – paste your Razorpay and Shiprocket details here, COD fee/limit, shipping charge, store details

## Connecting Razorpay

1. Razorpay Dashboard → Account & Settings → API Keys → generate keys (start with **Test mode**).
2. Admin → Settings → Razorpay: paste Key ID (`rzp_test_…`) and Key Secret, choose any strong *webhook secret*, switch on, **Save**, then press **Test keys**.
3. Razorpay Dashboard → Webhooks → add the URL shown in the Settings page (`https://YOUR-DOMAIN/api/webhooks/razorpay`), same secret, events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`.
4. Place a test order with Razorpay test card/UPI. When happy, replace with `rzp_live_…` keys.

The key secret is stored AES-encrypted on the server and is never sent to the browser. Payments are confirmed twice — by signature check when the customer returns, and by webhook as a safety net.

## Connecting Shiprocket

1. Shiprocket → Settings → API → *Add new API user* (needs an email different from your normal login).
2. Shiprocket → Settings → Pickup addresses: note the exact pickup location name.
3. Admin → Settings → Shiprocket: API user email + password, pickup location name, package size, switch on, **Save**, **Test login**.
4. Open any paid/COD order → **Create shipment**. The store creates the Shiprocket order, assigns a courier (AWB), requests pickup, and the customer gets the tracking link. **Refresh tracking** pulls the courier status.
5. Optional: add `https://YOUR-DOMAIN/api/webhooks/shiprocket` in Shiprocket → Settings → Webhooks with the token you chose as `x-api-key` for automatic status updates.

## Putting it on the internet

Any host that runs Node works (a ₹400–₹800/month VPS, Railway, Render, Fly.io). It must have a **persistent disk** for `DATA_DIR`
and run **one** instance. Put it behind HTTPS (Razorpay requires it for live payments). A `Dockerfile` is included:

```bash
docker build -t chaskatea .
docker run -d -p 3000:3000 -v chaskatea-data:/data -e DATA_DIR=/data -e ADMIN_PASSWORD='choose-one' chaskatea
```

## Tests

`node test/e2e.js` starts a throw-away copy plus mock Razorpay/Shiprocket servers and checks ~65 things end to end
(signup, cart, coupons, COD, Razorpay create/verify/webhook/refund, Shiprocket shipment/AWB/tracking/webhook, admin permissions, secret handling).
The mocks imitate the documented API shapes; they are not the real services, so do one real test-mode order after adding your keys.

## Layout

```
server.js            HTTP server, API routes, static files
lib/                 db (JSON file, atomic writes), pricing + orders, razorpay, shiprocket, seed
public/              pages (index, shop, product, cart, checkout, …), css/, js/, img/, admin/, account/
test/                end-to-end test + mock gateways
```

## Honest limits

* Data is a single JSON file (fast and fine for thousands of orders on one server). If you outgrow it, swap `lib/db.js` for SQLite/Postgres.
* No email/SMS sending yet (order updates are shown in the account / tracking page). Forgot-password = admin resets it from Customers.
* Pincode serviceability is not pre-checked; Shiprocket reports it when creating the shipment.
