# SellerOS

> **Multi-Platform Seller Inventory & Order Management System**
> BCSE302L — Database Systems | Team Lab Task 1 | VIT Chennai | March 2026

**Stack:** MySQL 8.0 · Node.js · Express · Vanilla HTML/CSS/JS

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Database Setup](#2-database-setup)
3. [Triggers](#3-triggers--member-1)
4. [Transactions & EXPLAIN](#4-transactions--explain--member-2)
5. [Auth & RBAC](#5-user-auth--restricted-operations--member-3)
6. [Backend Setup](#6-backend-setup)
7. [Login Credentials](#7-login-credentials)
8. [API Reference](#8-api-reference)
9. [DBMS Concepts](#9-dbms-concepts-mapping)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Project Structure

```
D:\Selleros\
├── schema.sql                    ← Creates database, 12 tables, 3 triggers, seed data
├── schema_auth.sql               ← Adds OTP tokens, activity log, phone column to users
├── schema_customer.sql           ← Adds 6 customer shopping tables + cart-clear trigger
├── schema_extra_triggers.sql     ← Adds stock pre-check BEFORE INSERT trigger
├── README.md
├── backend\
│   ├── server.js                 ← Node.js/Express REST API
│   ├── package.json
│   ├── .env.example              ← Copy to .env and fill in your password
│   └── .env                      ← Your actual DB credentials (you create this)
└── frontend\
    ├── user-environment.html     ← Customer shopping site
    └── admin-environment.html    ← Staff portal — all 5 roles, single login
```

---

## 2. Database Setup

Open PowerShell, enter MySQL, then run each file **in order**. Never skip a step.

```powershell
mysql -u root -p
```

### Step 1 — `schema.sql`

Creates the `selleros` database from scratch. All other files depend on this.

```sql
source D:/Selleros/schema.sql
```

**Tables created:**

| # | Table | Key Details |
|---|-------|-------------|
| 1 | `branches` | id, name, city, state, is_active — **4 seed rows** |
| 2 | `platforms` | id, name UNIQUE, is_active — Amazon, Flipkart, Own Website, Offline |
| 3 | `roles` | id, name ENUM(Admin/Manager/Seller/Viewer/Delivery) — 5 rows |
| 4 | `role_permissions` | role_id FK + can_view, can_insert, can_update, can_delete BOOLEAN |
| 5 | `users` | username UNIQUE, email UNIQUE, phone UNIQUE, password, role_id FK, branch_id FK — **8 seed rows** |
| 6 | `categories` | id, name UNIQUE — Electronics, Clothing, Sports |
| 7 | `products` | name, emoji, category_id FK, cost_price, sell_price — **10 seed rows** |
| 8 | `inventory` | product_id + branch_id + platform_id UNIQUE triplet, stock CHECK >= 0 — **22 seed rows** |
| 9 | `customers` | id, name, phone, email, address — **6 seed rows** |
| 10 | `orders` | order_ref UNIQUE, 5 FK constraints, payment_method ENUM, status ENUM — **8 seed rows** |
| 11 | `deliveries` | delivery_ref UNIQUE, order_id UNIQUE FK, staff_id FK, status ENUM |
| 12 | `trigger_logs` | event_type, description, logged_at — auto-filled by triggers |

**Triggers created by `schema.sql`:**

| Trigger | Event | Action |
|---------|-------|--------|
| `trg_inv_deduct_on_order` | AFTER INSERT on orders | Deducts NEW.qty from inventory; inserts row into trigger_logs |
| `trg_prevent_negative_stock` | BEFORE UPDATE on inventory | SIGNAL SQLSTATE 45000 if NEW.stock < 0 |
| `trg_log_order_status` | AFTER UPDATE on orders | Logs OLD.status → NEW.status to trigger_logs when status changes |

---

### Step 2 — `schema_auth.sql`

```sql
source D:/Selleros/schema_auth.sql
```

| Change | Detail |
|--------|--------|
| ALTER TABLE users | Adds `phone`, `avatar_initials`, `updated_at` columns if not present |
| `password_reset_tokens` | 6-digit OTP, identifier, expires_at (15 min), used BOOLEAN — FK to users |
| `user_activity_log` | Tracks LOGIN / REGISTER / CHANGE_PASSWORD / EDIT_PROFILE / RESET_PASSWORD with IP |
| Indexes | `idx_reset_token` on (user_id, token); `idx_activity_user` on (user_id) |
| Phone seed data | Sets phone 9876543210–9876543217 for all 8 seed staff users |

---

### Step 3 — `schema_customer.sql`

```sql
source D:/Selleros/schema_customer.sql
```

| Table | Key Columns |
|-------|-------------|
| `customer_accounts` | id, name, email UNIQUE, phone UNIQUE, password, is_active — separate from staff users |
| `customer_addresses` | customer_id FK, label (Home/Work/Other), name, phone, line1, line2, city, state, pincode, is_default |
| `cart` | customer_id + product_id + platform_id + branch_id UNIQUE key, qty |
| `wishlist` | customer_id + product_id UNIQUE — toggle add/remove |
| `customer_orders` | customer_id FK → order_id FK (orders table) → address_id FK |
| `customer_otp_tokens` | 6-digit OTP with expires_at for customer forgot-password flow |

**Trigger added:**

| Trigger | Event | Action |
|---------|-------|--------|
| `trg_clear_cart_on_order` | AFTER INSERT on customer_orders | Deletes all cart rows for that customer; logs to trigger_logs |

**Seed data:** 3 demo customer accounts + 1 saved address for Priya Mehta.

---

### Step 4 — `schema_extra_triggers.sql`

```sql
source D:/Selleros/schema_extra_triggers.sql
```

| Trigger | Event | Action |
|---------|-------|--------|
| `trg_check_stock_before_order` | BEFORE INSERT on orders | Queries inventory for product/branch/platform triplet; SIGNAL 45000 if stock < qty |

---

### Step 5 — Fill all inventory to 100 units

Run these lines **one at a time** inside MySQL (press Enter after each line):

```sql
INSERT INTO inventory (product_id, branch_id, platform_id, stock)
SELECT p.id, b.id, pl.id, 100
FROM products p
CROSS JOIN branches b
CROSS JOIN platforms pl
ON DUPLICATE KEY UPDATE stock = 100;
```

---

## 3. Triggers *(Member 1)*

5 triggers fire automatically — no application code needed.

| # | Trigger | File | Event | Action |
|---|---------|------|-------|--------|
| 1 | `trg_inv_deduct_on_order` | schema.sql | AFTER INSERT on orders | Deducts stock from inventory; writes to trigger_logs |
| 2 | `trg_prevent_negative_stock` | schema.sql | BEFORE UPDATE on inventory | Raises SQLSTATE 45000 if stock would go below 0 |
| 3 | `trg_log_order_status` | schema.sql | AFTER UPDATE on orders | Logs OLD → NEW status change to trigger_logs |
| 4 | `trg_clear_cart_on_order` | schema_customer.sql | AFTER INSERT on customer_orders | Clears customer cart; logs to trigger_logs |
| 5 | `trg_check_stock_before_order` | schema_extra_triggers.sql | BEFORE INSERT on orders | Blocks insert if inventory stock < qty ordered |

---

## 4. Transactions & EXPLAIN *(Member 2)*

### Transactions

Three endpoints use explicit `BEGIN` / `COMMIT` / `ROLLBACK`. Any failure rolls back everything.

| Endpoint | Steps | Rollback Trigger |
|----------|-------|-----------------|
| `POST /api/orders` | Stock check → upsert customer → INSERT order → trigger fires → COMMIT | Insufficient stock, any DB error |
| `POST /api/transactions/stock-transfer` | Verify source stock → deduct source → add destination → log → COMMIT | Source stock < qty |
| `POST /api/transactions/bulk-order` | Upsert customer → loop items (stock check + INSERT each) → COMMIT all | Any single item fails — all rollback |

### EXPLAIN

6 named queries available for analysis via the API:

| Query Key | What it demonstrates |
|-----------|----------------------|
| `inventory_by_branch` | JOIN on 3 tables with WHERE — index on uq_inv triplet |
| `orders_revenue_by_platform` | GROUP BY + SUM — aggregate performance |
| `orders_by_seller` | Indexed FK lookup on seller_id |
| `low_stock_alert` | Range scan on stock column with 3-way JOIN |
| `user_rbac_lookup` | 3-table JOIN for role + permission flags |
| `delivery_full_join` | 5-table JOIN across orders, users, customers, products, branches |

```
GET http://localhost:3001/api/explain?query=inventory_by_branch
GET http://localhost:3001/api/explain/all
```

---

## 5. User Auth & Restricted Operations *(Member 3)*

### Staff Portal — `admin-environment.html`

Single login page accepts all 5 roles using username + password. Sidebar and navigation adjust automatically per role.

| Role | Sidebar Access | can_insert | can_update | can_delete |
|------|---------------|:----------:|:----------:|:----------:|
| Admin | All modules | ✅ | ✅ | ✅ |
| Manager | Dashboard, Inventory, Orders, Deliveries, Users, Branches | ✅ | ✅ | ❌ |
| Seller | Dashboard, Inventory (view), Orders | ✅ | ❌ | ❌ |
| Viewer | Dashboard, Inventory (view), Orders (view) | ❌ | ❌ | ❌ |
| Delivery | Dashboard, Deliveries only | ❌ | ✅ | ❌ |

### Customer Shopping Site — `user-environment.html`

Separate authentication using email **or** phone + password. Customers have zero access to staff endpoints.

| Endpoint | Description |
|----------|-------------|
| `POST /api/customer/register` | Name + email or phone + password (min 6 chars) |
| `POST /api/customer/login` | Email or phone + password — returns customer object |
| `POST /api/customer/forgot-password` | Generates 6-digit OTP — returned in response (demo mode) |
| `POST /api/customer/verify-otp` | Verifies OTP — marks token used |
| `POST /api/customer/reset-password` | Set new password after OTP verified |
| `POST /api/customer/change-password` | Requires current password to change |
| `PATCH /api/customer/profile` | Update name, email, phone with uniqueness checks |

### Server-Enforced Restricted Routes

`requireRole()` middleware checks the role **live from the database** on every request. Wrong role = `HTTP 403 Forbidden`.

| Route | Allowed Roles | Blocked |
|-------|--------------|---------|
| `GET /api/users` | Admin, Manager | Seller, Viewer, Delivery |
| `POST /api/users` | Admin | Everyone else |
| `POST /api/products` | Admin, Manager | Everyone else |
| `PATCH /api/inventory` | Admin, Manager | Everyone else |
| `DELETE /api/orders/:id` | Admin | Everyone else |
| `POST /api/transactions/*` | Admin, Manager | Seller, Viewer, Delivery |
| `PATCH /api/users/:id/role` | Admin | Everyone else |

```
GET http://localhost:3001/api/permissions/check?user_id=3
```

---

## 6. Backend Setup

### Install dependencies

```powershell
cd D:\Selleros\backend
npm install
```

### Create `.env` file

In Notepad, save a new file named `.env` (File type → All Files) inside `D:\Selleros\backend\`:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password_here
DB_NAME=selleros
PORT=3001
```

### Start the server

```powershell
node server.js
```

Expected output:

```
✅ MySQL connected on port 3306
🚀 SellerOS API running at http://localhost:3001
```

> **Important:** The backend must be running before you open either HTML file.

---

## 7. Login Credentials

### Staff Portal — `admin-environment.html`

| Username | Password | Role | Branch |
|----------|----------|------|--------|
| `arjun` | `admin123` | Admin | No branch (global) |
| `preeti` | `manager123` | Manager | Mumbai Central |
| `vijay` | `manager123` | Manager | Bangalore South |
| `rahul` | `seller123` | Seller | Mumbai Central |
| `sunita` | `seller123` | Seller | Delhi NCR |
| `neha` | `viewer123` | Viewer | Delhi NCR |
| `karan` | `delivery123` | Delivery | Mumbai Central |
| `amit` | `delivery123` | Delivery | Delhi NCR |

### Customer Shopping Site — `user-environment.html`

| Email / Phone | Password | Name |
|---------------|----------|------|
| `priya@email.com` / `9876543210` | `priya123` | Priya Mehta |
| `aakash@email.com` / `9123456780` | `aakash123` | Aakash Joshi |
| `kavya@email.com` / `9012345678` | `kavya123` | Kavya Reddy |

---

## 8. API Reference

All endpoints: `http://localhost:3001`

### Staff Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login — returns user + role + permission flags |
| POST | `/api/auth/register` | Register staff (default role: Seller) |
| POST | `/api/auth/forgot-password` | Generate 6-digit OTP |
| POST | `/api/auth/verify-otp` | Verify OTP |
| POST | `/api/auth/reset-password` | Set new password after OTP verified |
| POST | `/api/auth/change-password` | Change password using current password |
| PATCH | `/api/auth/profile` | Update name, email, phone |
| GET | `/api/auth/activity/:user_id` | Last 20 activity log entries |
| GET | `/api/permissions/check` | Returns role + all permission flags for `?user_id=N` |

### Inventory & Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inventory` | Inventory with optional branch_id, platform_id filters |
| PATCH | `/api/inventory/:pid/:bid/:plid` | Update stock — Admin/Manager only |
| GET | `/api/products` | All products with total stock aggregated |
| POST | `/api/products` | Create product — Admin/Manager only |
| GET | `/api/categories` | All categories |
| GET | `/api/platforms` | All platforms |
| GET | `/api/branches` | Branches with today's revenue stats |

### Orders, Deliveries & Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders` | Orders with filters — status, branch_id, platform_id, seller_id |
| POST | `/api/orders` | Place order — full transaction, triggers fire on INSERT |
| PATCH | `/api/orders/:id/status` | Update order status — trg_log_order_status fires |
| DELETE | `/api/orders/:id` | Delete order + restore stock — Admin only |
| GET | `/api/deliveries` | Deliveries with staff and order info |
| PATCH | `/api/deliveries/:id/status` | Update delivery status |
| GET | `/api/users` | All users with role/branch — Admin/Manager only |
| POST | `/api/users` | Create staff user — Admin only |
| PATCH | `/api/users/:id/active` | Activate or deactivate user — Admin only |
| PATCH | `/api/users/:id/role` | Reassign role and branch — Admin only |

### Dashboard, Transactions & EXPLAIN

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/kpis` | Live KPI numbers — revenue, orders, stock alerts |
| GET | `/api/dashboard/platform-revenue` | Revenue per platform today |
| GET | `/api/dashboard/branch-revenue` | Revenue per branch today |
| GET | `/api/dashboard/order-status-counts` | Order counts grouped by status |
| GET | `/api/trigger-logs` | Latest trigger_logs entries — `?limit=N` |
| POST | `/api/transactions/stock-transfer` | Atomic stock move between branches |
| POST | `/api/transactions/bulk-order` | Multiple order lines in one atomic transaction |
| GET | `/api/explain?query=<key>` | EXPLAIN output for named query — 6 keys available |
| GET | `/api/explain/all` | EXPLAIN all 6 queries at once |
| GET | `/api/health` | DB connectivity check |

### Customer Shopping Site

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/customer/register` | Register customer account |
| POST | `/api/customer/login` | Login with email or phone + password |
| POST | `/api/customer/forgot-password` | Request OTP |
| POST | `/api/customer/verify-otp` | Verify OTP |
| POST | `/api/customer/reset-password` | Set new password after OTP |
| POST | `/api/customer/change-password` | Change password using current |
| PATCH | `/api/customer/profile` | Update profile |
| GET | `/api/customer/products` | Browse products — public, no login needed |
| GET | `/api/customer/categories` | All categories — public |
| GET | `/api/customer/cart/:id` | Get cart items with stock availability |
| POST | `/api/customer/cart` | Add or update cart item (upsert) |
| DELETE | `/api/customer/cart/:id` | Remove single cart item |
| DELETE | `/api/customer/cart/clear/:id` | Clear entire cart |
| GET | `/api/customer/wishlist/:id` | Get wishlist |
| POST | `/api/customer/wishlist` | Toggle wishlist — add if absent, remove if present |
| GET | `/api/customer/addresses/:id` | Get saved addresses — default first |
| POST | `/api/customer/addresses` | Add new address |
| DELETE | `/api/customer/addresses/:id` | Delete address |
| PATCH | `/api/customer/addresses/:id/default` | Set default address |
| POST | `/api/customer/orders` | Place order from cart — full transaction |
| GET | `/api/customer/orders/:id` | Order history with delivery status |

---

## 9. DBMS Concepts Mapping

| Concept | Where | Detail |
|---------|-------|--------|
| **Triggers** | schema.sql, schema_customer.sql, schema_extra_triggers.sql | 5 triggers — stock deduction, negative stock block, status log, cart clear, stock pre-check |
| **Transactions** | server.js — `/api/orders`, `/stock-transfer`, `/bulk-order` | Explicit BEGIN/COMMIT/ROLLBACK — full rollback on any failure |
| **EXPLAIN** | server.js — `GET /api/explain` | 6 named queries showing index usage, join type, rows scanned |
| **RBAC** | `role_permissions` table + `requireRole()` middleware | Flags stored in DB; enforced at API level on every sensitive route |
| **Referential Integrity** | FK constraints in schema.sql | orders → products, branches, platforms, customers, users |
| **Constraint Check** | `inventory CHECK(stock>=0)` + `trg_prevent_negative_stock` | Double protection — DB constraint + trigger both block negative stock |
| **Indexes** | schema.sql + schema_customer.sql | UNIQUE on inventory triplet, cart, wishlist; lookup indexes on OTP and activity log |

---

## 10. Troubleshooting

| Error / Symptom | Cause | Fix |
|-----------------|-------|-----|
| `MySQL connection failed` | `.env` password wrong or MySQL not running | Start MySQL via services.msc; check `DB_PASSWORD` in `.env` |
| `Table 'X' doesn't exist` | Schema files not run or out of order | Run all 4 SQL files in order using `source` inside MySQL |
| `Insufficient stock` | Product has 0 or no inventory row for that branch/platform | Run the CROSS JOIN INSERT to fill all inventory to 100 |
| `'<' operator not supported` | PowerShell doesn't support `<` redirection | Use: `mysql -u root -p` then `source D:/Selleros/file.sql` |
| `CORS error in browser` | Backend not running when HTML was opened | Start `node server.js` first, then open HTML files |
| `Port 3001 already in use` | Another process on the port | Set `PORT=3002` in `.env`; update `API_BASE` in both HTML files |
| `403 Forbidden` | User role not allowed for that route | Check `/api/permissions/check?user_id=N` |
| `OTP expired or already used` | OTP is single-use, expires in 15 minutes | Request a new OTP via forgot-password endpoint |
| `Duplicate entry on register` | Username, email, or phone already exists | All three are `UNIQUE` — use a different value |
