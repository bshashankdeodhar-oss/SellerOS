// ============================================================
//  SellerOS Backend — server.js
//  Express REST API connecting to MySQL on port 3306
//  Start: node server.js   (or: npm run dev  for auto-reload)
// ============================================================

require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const mysql   = require("mysql2/promise");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// ── MySQL Connection Pool ─────────────────────────────────────
const pool = mysql.createPool({
    host:               process.env.DB_HOST     || "localhost",
    port:               parseInt(process.env.DB_PORT) || 3306,
    user:               process.env.DB_USER     || "root",
    password:           process.env.DB_PASSWORD || "",
    database:           process.env.DB_NAME     || "selleros",
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
});

// Test connection on startup
pool.getConnection()
    .then(conn => { console.log("✅ MySQL connected on port", process.env.DB_PORT || 3306); conn.release(); })
    .catch(err  => { console.error("❌ MySQL connection failed:", err.message); process.exit(1); });

// ── Helper ────────────────────────────────────────────────────
const query = (sql, params) => pool.execute(sql, params);

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────

// POST /api/auth/login
// Body: { username, password }
// Returns user info + role + permissions
app.post("/api/auth/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await query(
            `SELECT u.id, u.name, u.username, u.email, u.is_active,
                    r.name AS role,
                    b.name AS branch, b.id AS branch_id,
                    rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
             FROM   users u
             JOIN   roles r            ON u.role_id   = r.id
             LEFT JOIN branches b      ON u.branch_id  = b.id
             JOIN   role_permissions rp ON r.id        = rp.role_id
             WHERE  u.username = ? AND u.password = ? AND u.is_active = TRUE`,
            [username, password]
        );
        if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });
        res.json({ success: true, user: rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  BRANCHES
// ─────────────────────────────────────────────────────────────

// GET /api/branches
app.get("/api/branches", async (_req, res) => {
    try {
        const [rows] = await query(
            `SELECT b.*,
                    COUNT(DISTINCT o.id)    AS total_orders,
                    COALESCE(SUM(o.total_amount), 0) AS total_revenue,
                    COUNT(DISTINCT u.id)    AS staff_count,
                    COALESCE(SUM(i.stock),0) AS total_stock
             FROM   branches b
             LEFT JOIN orders    o ON o.branch_id = b.id
             LEFT JOIN users     u ON u.branch_id = b.id AND u.is_active = TRUE
             LEFT JOIN inventory i ON i.branch_id = b.id
             WHERE  b.is_active = TRUE
             GROUP BY b.id
             ORDER BY b.name`, []
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/branches
app.post("/api/branches", async (req, res) => {
    try {
        const { name, city, state } = req.body;
        const [result] = await query(
            "INSERT INTO branches (name, city, state) VALUES (?, ?, ?)",
            [name, city, state]
        );
        res.json({ success: true, id: result.insertId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  PLATFORMS
// ─────────────────────────────────────────────────────────────

// GET /api/platforms
app.get("/api/platforms", async (_req, res) => {
    try {
        const [rows] = await query("SELECT * FROM platforms WHERE is_active = TRUE", []);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  INVENTORY
// ─────────────────────────────────────────────────────────────

// GET /api/inventory
// Query params: branch_id, platform_id, category_id, stock (in|low|out), search
app.get("/api/inventory", async (req, res) => {
    try {
        const { branch_id, platform_id, category_id, stock, search } = req.query;
        let sql = `
            SELECT  p.id AS product_id, p.name, p.emoji,
                    c.name AS category,
                    b.name AS branch, b.id AS branch_id,
                    pl.name AS platform, pl.id AS platform_id,
                    p.cost_price, p.sell_price,
                    i.stock, i.updated_at
            FROM    inventory i
            JOIN    products  p  ON i.product_id  = p.id
            JOIN    categories c ON p.category_id = c.id
            JOIN    branches   b ON i.branch_id   = b.id
            JOIN    platforms  pl ON i.platform_id = pl.id
            WHERE   1=1`;
        const params = [];

        if (branch_id)   { sql += " AND i.branch_id = ?";    params.push(branch_id); }
        if (platform_id) { sql += " AND i.platform_id = ?";  params.push(platform_id); }
        if (category_id) { sql += " AND p.category_id = ?";  params.push(category_id); }
        if (search)      { sql += " AND p.name LIKE ?";      params.push(`%${search}%`); }
        if (stock === "in")  sql += " AND i.stock > 8";
        if (stock === "low") sql += " AND i.stock > 0 AND i.stock <= 8";
        if (stock === "out") sql += " AND i.stock = 0";

        sql += " ORDER BY p.name, b.name";
        const [rows] = await query(sql, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/inventory/:product_id/:branch_id/:platform_id
// Body: { stock }  — admin stock correction
app.patch("/api/inventory/:product_id/:branch_id/:platform_id", async (req, res) => {
    try {
        const { product_id, branch_id, platform_id } = req.params;
        const { stock } = req.body;
        await query(
            "UPDATE inventory SET stock = ? WHERE product_id=? AND branch_id=? AND platform_id=?",
            [stock, product_id, branch_id, platform_id]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  PRODUCTS
// ─────────────────────────────────────────────────────────────

// GET /api/products  (distinct product list with aggregated stock)
app.get("/api/products", async (req, res) => {
    try {
        const { branch_id, search, category_id } = req.query;
        let sql = `
            SELECT  p.id, p.name, p.emoji, c.name AS category,
                    p.cost_price, p.sell_price,
                    COALESCE(SUM(i.stock), 0) AS total_stock,
                    GROUP_CONCAT(DISTINCT pl.name ORDER BY pl.name SEPARATOR ', ') AS platforms
            FROM    products p
            JOIN    categories c ON p.category_id = c.id
            LEFT JOIN inventory i  ON i.product_id = p.id
            LEFT JOIN platforms pl ON i.platform_id = pl.id`;
        const params = [];
        const where = [];
        if (branch_id)   { where.push("i.branch_id = ?");    params.push(branch_id); }
        if (search)      { where.push("p.name LIKE ?");      params.push(`%${search}%`); }
        if (category_id) { where.push("p.category_id = ?");  params.push(category_id); }
        if (where.length) sql += " WHERE " + where.join(" AND ");
        sql += " GROUP BY p.id ORDER BY p.name";
        const [rows] = await query(sql, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/products
app.post("/api/products", async (req, res) => {
    try {
        const { name, emoji, category_id, cost_price, sell_price } = req.body;
        const [result] = await query(
            "INSERT INTO products (name, emoji, category_id, cost_price, sell_price) VALUES (?,?,?,?,?)",
            [name, emoji || "📦", category_id, cost_price, sell_price]
        );
        res.json({ success: true, id: result.insertId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/categories
app.get("/api/categories", async (_req, res) => {
    try {
        const [rows] = await query("SELECT * FROM categories ORDER BY name", []);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  ORDERS
// ─────────────────────────────────────────────────────────────

// GET /api/orders
// Query params: branch_id, platform_id, seller_id, status, search, limit
app.get("/api/orders", async (req, res) => {
    try {
        const { branch_id, platform_id, seller_id, status, search, limit } = req.query;
        let sql = `
            SELECT  o.*,
                    p.name  AS product_name, p.emoji,
                    b.name  AS branch_name,
                    pl.name AS platform_name,
                    c.name  AS customer_name,
                    u.name  AS seller_name
            FROM    orders o
            JOIN    products  p  ON o.product_id  = p.id
            JOIN    branches  b  ON o.branch_id   = b.id
            JOIN    platforms pl ON o.platform_id = pl.id
            JOIN    customers c  ON o.customer_id = c.id
            JOIN    users     u  ON o.seller_id   = u.id
            WHERE   1=1`;
        const params = [];
        if (branch_id)   { sql += " AND o.branch_id = ?";   params.push(branch_id); }
        if (platform_id) { sql += " AND o.platform_id = ?"; params.push(platform_id); }
        if (seller_id)   { sql += " AND o.seller_id = ?";   params.push(seller_id); }
        if (status)      { sql += " AND o.status = ?";      params.push(status); }
        if (search)      { sql += " AND (o.order_ref LIKE ? OR c.name LIKE ? OR p.name LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
        sql += " ORDER BY o.created_at DESC";
        if (limit)       { sql += " LIMIT ?"; params.push(parseInt(limit)); }

        const [rows] = await query(sql, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/orders  — place a new order (triggers run automatically in MySQL)
app.post("/api/orders", async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const { product_id, branch_id, platform_id, customer_name, customer_phone,
                customer_address, qty, payment_method, seller_id, notes } = req.body;

        // Check stock
        const [[inv]] = await conn.execute(
            "SELECT stock, sell_price FROM inventory i JOIN products p ON i.product_id=p.id WHERE i.product_id=? AND i.branch_id=? AND i.platform_id=?",
            [product_id, branch_id, platform_id]
        );
        if (!inv || inv.stock < qty) {
            await conn.rollback();
            return res.status(400).json({ error: "Insufficient stock" });
        }

        // Upsert customer
        let customer_id;
        const [[existing]] = await conn.execute(
            "SELECT id FROM customers WHERE phone = ?", [customer_phone || ""]
        );
        if (existing) {
            customer_id = existing.id;
        } else {
            const [cres] = await conn.execute(
                "INSERT INTO customers (name, phone, address) VALUES (?,?,?)",
                [customer_name, customer_phone || null, customer_address || null]
            );
            customer_id = cres.insertId;
        }

        // Generate order ref
        const [[{ maxId }]] = await conn.execute("SELECT COALESCE(MAX(id),2200) AS maxId FROM orders");
        const order_ref = `ORD-${maxId + 1}`;
        const total_amount = inv.sell_price * qty;

        // Insert order — trigger trg_inv_deduct_on_order fires here
        const [ores] = await conn.execute(
            `INSERT INTO orders
               (order_ref, product_id, branch_id, platform_id, customer_id, seller_id,
                qty, unit_price, total_amount, payment_method, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [order_ref, product_id, branch_id, platform_id, customer_id, seller_id,
             qty, inv.sell_price, total_amount, payment_method || "UPI", notes || null]
        );

        await conn.commit();
        res.json({ success: true, order_ref, order_id: ores.insertId, total_amount });
    } catch (e) {
        await conn.rollback();
        res.status(500).json({ error: e.message });
    } finally {
        conn.release();
    }
});

// PATCH /api/orders/:id/status
app.patch("/api/orders/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        await query("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  DELIVERIES
// ─────────────────────────────────────────────────────────────

// GET /api/deliveries
// Query params: staff_id, branch_id, status
app.get("/api/deliveries", async (req, res) => {
    try {
        const { staff_id, branch_id, status } = req.query;
        let sql = `
            SELECT  d.*,
                    o.order_ref, o.total_amount,
                    p.name  AS product_name,
                    c.name  AS customer_name, c.address AS delivery_address,
                    u.name  AS staff_name,
                    b.name  AS branch_name
            FROM    deliveries d
            JOIN    orders    o  ON d.order_id  = o.id
            JOIN    products  p  ON o.product_id = p.id
            JOIN    customers c  ON o.customer_id = c.id
            JOIN    users     u  ON d.staff_id   = u.id
            JOIN    branches  b  ON o.branch_id  = b.id
            WHERE   1=1`;
        const params = [];
        if (staff_id)  { sql += " AND d.staff_id = ?";   params.push(staff_id); }
        if (branch_id) { sql += " AND o.branch_id = ?";  params.push(branch_id); }
        if (status)    { sql += " AND d.status = ?";     params.push(status); }
        sql += " ORDER BY d.updated_at DESC";
        const [rows] = await query(sql, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/deliveries/:id/status  — delivery staff updates status
app.patch("/api/deliveries/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        await query("UPDATE deliveries SET status = ? WHERE id = ?", [status, req.params.id]);
        // If delivered, also update order status
        if (status === "Delivered") {
            await query(
                "UPDATE orders SET status = 'Delivered' WHERE id = (SELECT order_id FROM deliveries WHERE id = ?)",
                [req.params.id]
            );
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  USERS (admin only)
// ─────────────────────────────────────────────────────────────

// GET /api/users
app.get("/api/users", async (req, res) => {
    try {
        const { role, branch_id } = req.query;
        let sql = `
            SELECT  u.id, u.name, u.username, u.email, u.is_active, u.created_at,
                    r.name AS role,
                    b.name AS branch
            FROM    users u
            JOIN    roles r       ON u.role_id   = r.id
            LEFT JOIN branches b  ON u.branch_id = b.id
            WHERE   1=1`;
        const params = [];
        if (role)      { sql += " AND r.name = ?";       params.push(role); }
        if (branch_id) { sql += " AND u.branch_id = ?";  params.push(branch_id); }
        sql += " ORDER BY r.name, u.name";
        const [rows] = await query(sql, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/users
app.post("/api/users", async (req, res) => {
    try {
        const { name, username, email, password, role_id, branch_id } = req.body;
        const [result] = await query(
            "INSERT INTO users (name, username, email, password, role_id, branch_id) VALUES (?,?,?,?,?,?)",
            [name, username, email, password, role_id, branch_id || null]
        );
        res.json({ success: true, id: result.insertId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/users/:id/active
app.patch("/api/users/:id/active", async (req, res) => {
    try {
        const { is_active } = req.body;
        await query("UPDATE users SET is_active = ? WHERE id = ?", [is_active, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/users/:id/role
app.patch("/api/users/:id/role", async (req, res) => {
    try {
        const { role_id, branch_id } = req.body;
        await query("UPDATE users SET role_id = ?, branch_id = ? WHERE id = ?",
            [role_id, branch_id || null, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  DASHBOARD / ANALYTICS  (admin only)
// ─────────────────────────────────────────────────────────────

// GET /api/dashboard/kpis
app.get("/api/dashboard/kpis", async (_req, res) => {
    try {
        const [[revenue]]  = await query("SELECT COALESCE(SUM(total_amount),0) AS value FROM orders WHERE DATE(created_at) = CURDATE()", []);
        const [[orders]]   = await query("SELECT COUNT(*) AS value FROM orders WHERE DATE(created_at) = CURDATE()", []);
        const [[products]] = await query("SELECT COUNT(*) AS value FROM products", []);
        const [[outStock]] = await query("SELECT COUNT(*) AS value FROM inventory WHERE stock = 0", []);
        const [[transit]]  = await query("SELECT COUNT(*) AS value FROM deliveries WHERE status IN ('Picked Up','Out for Delivery')", []);
        res.json({ revenue: revenue.value, orders: orders.value, products: products.value, out_of_stock: outStock.value, in_transit: transit.value });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dashboard/platform-revenue
app.get("/api/dashboard/platform-revenue", async (_req, res) => {
    try {
        const [rows] = await query(
            `SELECT pl.name AS platform,
                    COUNT(o.id)       AS order_count,
                    COALESCE(SUM(o.total_amount), 0) AS revenue
             FROM   platforms pl
             LEFT JOIN orders o ON o.platform_id = pl.id AND DATE(o.created_at) = CURDATE()
             GROUP BY pl.id
             ORDER BY revenue DESC`, []
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dashboard/branch-revenue
app.get("/api/dashboard/branch-revenue", async (_req, res) => {
    try {
        const [rows] = await query(
            `SELECT b.name AS branch,
                    COUNT(o.id) AS order_count,
                    COALESCE(SUM(o.total_amount), 0) AS revenue
             FROM   branches b
             LEFT JOIN orders o ON o.branch_id = b.id AND DATE(o.created_at) = CURDATE()
             GROUP BY b.id
             ORDER BY revenue DESC`, []
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dashboard/order-status-counts
app.get("/api/dashboard/order-status-counts", async (_req, res) => {
    try {
        const [rows] = await query(
            `SELECT status, COUNT(*) AS count
             FROM   orders
             GROUP BY status`, []
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  TRIGGER LOGS
// ─────────────────────────────────────────────────────────────

// GET /api/trigger-logs?limit=20
app.get("/api/trigger-logs", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const [rows] = await query(
            "SELECT * FROM trigger_logs ORDER BY logged_at DESC LIMIT ?",
            [limit]
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
    try {
        await query("SELECT 1", []);
        res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ status: "error", db: "disconnected", error: e.message });
    }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 SellerOS API running at http://localhost:${PORT}`);
    console.log(`   MySQL → ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}`);
    console.log(`\n   Endpoints:`);
    console.log(`   POST /api/auth/login`);
    console.log(`   GET  /api/inventory`);
    console.log(`   GET  /api/orders`);
    console.log(`   POST /api/orders`);
    console.log(`   GET  /api/deliveries`);
    console.log(`   GET  /api/users`);
    console.log(`   GET  /api/dashboard/kpis`);
    console.log(`   GET  /api/trigger-logs\n`);
});
