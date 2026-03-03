# SellerOS — Full Stack Setup Guide

Everything you need to go from zero to a live, MySQL-powered SellerOS.

---

## What's in this package

```
D:\Selleros\
├── schema.sql                    ← Run first — creates database, tables, triggers, seed data
├── schema_auth.sql               ← Run second — adds OTP tokens and activity log
├── schema_customer.sql           ← Run third — adds customer shopping tables
├── schema_extra_triggers.sql     ← Run fourth — adds stock pre-check trigger
├── README.md
├── backend\
│   ├── server.js                 ← Node.js/Express API server
│   ├── package.json
│   └── .env.example              ← Copy to .env and fill in your password
└── frontend\
    ├── user-environment.html     ← Customer shopping site
    └── admin-environment.html    ← Staff portal (all roles — Admin to Delivery)
```

---

## Step 1 — Create the database

> **PowerShell note:** The `<` operator is not supported. Use `source` inside MySQL instead.

Open PowerShell and enter MySQL:

```powershell
mysql -u root -p

CREATE DATABASE SellerOS;
SHOW DATABASES;

```

Then run each file **in order**:

```sql
Get-Content schema.sql | mysql -u root -p selleros
Get-Content schema_auth.sql | mysql -u root -p selleros          
Get-Content schema_customer.sql | mysql -u root -p selleros      
Get-Content schema_extra_triggers.sql | mysql -u root -p selleros
```

Then fill all inventory to 100 units (type line by line, press Enter after each):

```sql
INSERT INTO inventory (product_id, branch_id, platform_id, stock)
SELECT p.id, b.id, pl.id, 100
FROM products p
CROSS JOIN branches b
CROSS JOIN platforms pl
ON DUPLICATE KEY UPDATE stock = 100;
```

Type `exit` when done.

---

## Step 2 — Set up the backend

### Install Node.js (if not already installed)
Download from https://nodejs.org — install the LTS version.

### Install dependencies

```powershell
cd D:\Selleros\backend
npm install
```

### Configure your database password

Create a file named `.env` inside `backend\` (Notepad → Save As → All Files → `.env`):

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_actual_password_here
DB_NAME=selleros
PORT=3001
```

### Start the server

```powershell
node server.js
```

You should see:
```
✅ MySQL connected on port 3306
🚀 SellerOS API running at http://localhost:3001
```

---

## Step 3 — Open the frontend

Open either HTML file directly in your browser:

| File | How to open |
|------|-------------|
| `user-environment.html` | Double-click it or drag into browser |
| `admin-environment.html` | Double-click it or drag into browser |

> **Important:** The backend server (Step 2) must be running before you open the HTML files.

---

## Login credentials (from seed data)

### Staff Portal — `admin-environment.html`
One login page for all roles — the sidebar adjusts based on who signs in.

| Username | Password | Role | Branch |
|----------|----------|------|--------|
| arjun | admin123 | Admin | — |
| preeti | manager123 | Manager | Mumbai Central |
| vijay | manager123 | Manager | Bangalore South |
| rahul | seller123 | Seller | Mumbai Central |
| sunita | seller123 | Seller | Delhi NCR |
| neha | viewer123 | Viewer | Delhi NCR |
| karan | delivery123 | Delivery | Mumbai Central |
| amit | delivery123 | Delivery | Delhi NCR |

### Customer Shopping Site — `user-environment.html`
Login with email or phone + password.

| Email / Phone | Password |
|---------------|----------|
| priya@email.com / 9876543210 | priya123 |
| aakash@email.com / 9123456780 | aakash123 |
| kavya@email.com / 9012345678 | kavya123 |

---

## API Endpoints reference

All endpoints run at `http://localhost:3001`

### Staff & General

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login, returns user + role + permissions |
| POST | /api/auth/register | Register new staff (default: Seller) |
| POST | /api/auth/forgot-password | Generate OTP for password reset |
| POST | /api/auth/verify-otp | Verify OTP code |
| POST | /api/auth/reset-password | Set new password after OTP |
| POST | /api/auth/change-password | Change password using current |
| PATCH | /api/auth/profile | Update name, email, phone |
| GET | /api/auth/activity/:user_id | Recent activity log |
| GET | /api/permissions/check | Check what user_id=N can do |
| GET | /api/inventory | Inventory with filters |
| GET | /api/products | Products with aggregated stock |
| GET | /api/categories | All product categories |
| GET | /api/platforms | All platforms |
| GET | /api/branches | Branches with revenue stats |
| GET | /api/orders | Orders with filters |
| POST | /api/orders | Place new order (transaction + triggers fire) |
| PATCH | /api/orders/:id/status | Update order status |
| DELETE | /api/orders/:id | Delete order + restore stock (Admin only) |
| GET | /api/deliveries | Deliveries with filters |
| PATCH | /api/deliveries/:id/status | Update delivery status |
| GET | /api/users | All users (Admin/Manager only) |
| POST | /api/users | Create user (Admin only) |
| PATCH | /api/users/:id/active | Activate/deactivate user |
| PATCH | /api/users/:id/role | Reassign role and branch |
| GET | /api/dashboard/kpis | Live KPI numbers |
| GET | /api/dashboard/platform-revenue | Revenue per platform (today) |
| GET | /api/dashboard/branch-revenue | Revenue per branch (today) |
| GET | /api/dashboard/order-status-counts | Order counts by status |
| GET | /api/trigger-logs | MySQL trigger log entries |
| POST | /api/transactions/stock-transfer | Move stock between branches (transaction) |
| POST | /api/transactions/bulk-order | Place multiple orders atomically (transaction) |
| GET | /api/explain?query=\<key\> | EXPLAIN output for a named query |
| GET | /api/explain/all | EXPLAIN all 6 queries at once |
| GET | /api/health | DB connectivity check |

### Customer Shopping Site

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/customer/register | Register customer account |
| POST | /api/customer/login | Login with email or phone + password |
| POST | /api/customer/forgot-password | Generate OTP |
| POST | /api/customer/verify-otp | Verify OTP |
| POST | /api/customer/reset-password | Set new password after OTP |
| POST | /api/customer/change-password | Change password |
| PATCH | /api/customer/profile | Update profile |
| GET | /api/customer/products | Browse products (public) |
| GET | /api/customer/categories | All categories (public) |
| GET | /api/customer/cart/:id | Get cart items |
| POST | /api/customer/cart | Add or update cart item |
| DELETE | /api/customer/cart/:id | Remove cart item |
| DELETE | /api/customer/cart/clear/:id | Clear entire cart |
| GET | /api/customer/wishlist/:id | Get wishlist |
| POST | /api/customer/wishlist | Toggle wishlist (add/remove) |
| GET | /api/customer/addresses/:id | Get saved addresses |
| POST | /api/customer/addresses | Add new address |
| DELETE | /api/customer/addresses/:id | Delete address |
| PATCH | /api/customer/addresses/:id/default | Set default address |
| POST | /api/customer/orders | Place order from cart (transaction) |
| GET | /api/customer/orders/:id | Order history with delivery status |

---

## How the DBMS concepts map to the code

| Concept | Where it lives |
|---------|----------------|
| Triggers | 5 triggers across `schema.sql`, `schema_customer.sql`, `schema_extra_triggers.sql` |
| Transactions | `server.js` → `POST /api/orders`, `/stock-transfer`, `/bulk-order` use BEGIN/COMMIT/ROLLBACK |
| EXPLAIN | `GET /api/explain` — 6 named queries, also visible in DB Insights tab |
| RBAC | `role_permissions` table + `requireRole()` middleware in `server.js` |
| Referential integrity | All FK constraints defined in `schema.sql` |
| Constraint check | `stock >= 0` CHECK + `trg_prevent_negative_stock` trigger |

---

## Troubleshooting

**"MySQL connection failed"**
→ Check your `.env` password. Try `mysql -u root -p` manually.

**"Table X doesn't exist"**
→ Run all 4 schema files in order using `source` inside MySQL.

**"Insufficient stock" on order**
→ Run the CROSS JOIN INSERT from Step 1 to fill all inventory to 100.

**"'<' operator not supported" in PowerShell**
→ Use `source D:/Selleros/schema.sql` inside MySQL instead of `<` redirection.

**CORS error in browser**
→ Make sure you started `node server.js` before opening the HTML file.

**Port 3001 already in use**
→ Change `PORT=3002` in `.env` and update `API_BASE` in both HTML files.

**403 Forbidden on an API call**
→ Your role doesn't have access. Check `/api/permissions/check?user_id=N`.

