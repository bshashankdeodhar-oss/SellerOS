# SellerOS — Full Stack Setup Guide

Everything you need to go from zero to a live, MySQL-powered SellerOS.

---

## What's in this package

```
selleros/
├── schema.sql                  ← Run once to create your database
├── backend/
│   ├── server.js               ← Node.js/Express API server
│   ├── package.json
│   └── .env.example            ← Copy to .env and fill in your password
└── frontend/
    ├── user-environment.html   ← User portal (Sellers, Viewers, Delivery)
    └── admin-environment.html  ← Admin portal (Admins, Managers)
```

---

## Step 1 — Create the database

Open your terminal and run:

```bash
cd SellerOS
Get-Content .\schema.sql | mysql -u root -p
```

This creates the `selleros` database with all tables, triggers, and seed data.

---

## Step 2 — Set up the backend

### Install Node.js (if not already installed)
Download from https://nodejs.org — install the LTS version.

### Install dependencies

```bash
cd backend
npm install
```

### Configure your database password

```bash
cp .env.example .env
```

Open `.env` in any text editor and set your MySQL root password:

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_actual_password_here
DB_NAME=selleros
PORT=3001
```

### Start the server

```bash
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

| File                       | URL to open                          |
|----------------------------|--------------------------------------|
| `user-environment.html`    | Double-click it or drag into browser |
| `admin-environment.html`   | Double-click it or drag into browser |

> **Important:** The backend server (Step 2) must be running before you open the HTML files.

---

## Login credentials (from seed data)

### User Environment

| Username | Password    | Role     | Branch          |
|----------|-------------|----------|-----------------|
| rahul    | seller123   | Seller   | Mumbai Central  |
| neha     | viewer123   | Viewer   | Delhi NCR       |
| karan    | delivery123 | Delivery | Mumbai Central  |
| amit     | delivery123 | Delivery | Delhi NCR       |

### Admin Environment

| Username | Password    | Role    |
|----------|-------------|---------|
| arjun    | admin123    | Admin   |
| preeti   | manager123  | Manager |
| vijay    | manager123  | Manager |

---

## API Endpoints reference

All endpoints run at `http://localhost:3001`

| Method | Endpoint                          | Description                        |
|--------|-----------------------------------|------------------------------------|
| POST   | /api/auth/login                   | Login, returns user + permissions  |
| GET    | /api/inventory                    | Inventory with filters             |
| GET    | /api/products                     | Products with aggregated stock     |
| GET    | /api/categories                   | All product categories             |
| GET    | /api/platforms                    | All platforms                      |
| GET    | /api/branches                     | Branches with revenue stats        |
| GET    | /api/orders                       | Orders with filters                |
| POST   | /api/orders                       | Place new order (triggers fire)    |
| PATCH  | /api/orders/:id/status            | Update order status                |
| GET    | /api/deliveries                   | Deliveries with filters            |
| PATCH  | /api/deliveries/:id/status        | Update delivery status             |
| GET    | /api/users                        | All users (admin only)             |
| POST   | /api/users                        | Create user                        |
| PATCH  | /api/users/:id/active             | Activate/deactivate user           |
| GET    | /api/dashboard/kpis               | Live KPI numbers                   |
| GET    | /api/dashboard/platform-revenue   | Revenue per platform (today)       |
| GET    | /api/dashboard/branch-revenue     | Revenue per branch (today)         |
| GET    | /api/dashboard/order-status-counts| Order counts by status             |
| GET    | /api/trigger-logs                 | MySQL trigger log entries          |
| GET    | /api/health                       | DB connectivity check              |

---

## How the DBMS concepts map to the code

| Concept          | Where it lives                                      |
|------------------|-----------------------------------------------------|
| Triggers         | `schema.sql` — 4 triggers auto-fire on data changes |
| Transactions     | `server.js` → `POST /api/orders` uses BEGIN/COMMIT/ROLLBACK |
| RBAC             | `role_permissions` table + `/auth/login` JOIN query |
| EXPLAIN analysis | DB Insights tab in Admin Environment                |
| Referential integrity | All FK constraints in `schema.sql`             |
| Constraint check | `stock >= 0` CHECK + `trg_prevent_negative_stock`  |

---

## Troubleshooting

**"MySQL connection failed"**
→ Check your `.env` password. Try `mysql -u root -p` manually.

**"Insufficient stock" on order**
→ The trigger check is working. Stock is 0 for that product.

**CORS error in browser**
→ Make sure you started `node server.js` before opening the HTML file.

**Port 3001 already in use**
→ Change `PORT=3002` in `.env` and update `API_BASE` in both HTML files.
#



