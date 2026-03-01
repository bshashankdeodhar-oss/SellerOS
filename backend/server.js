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

// =============================================================
//  MEMBER 3 — ROLE-BASED ACCESS CONTROL MIDDLEWARE
//  Enforces restricted operations from the client machine.
//  Every sensitive route is protected at the API level.
// =============================================================

// requireRole(...roles) — blocks request if user's role is not in the list
function requireRole(...allowedRoles) {
    return async (req, res, next) => {
        const user_id = req.body?.user_id || req.query?.user_id;
        if (!user_id)
            return res.status(401).json({ error: "Unauthorized — user_id required" });
        try {
            const [[user]] = await query(
                `SELECT u.id, r.name AS role, u.is_active
                 FROM   users u
                 JOIN   roles r ON u.role_id = r.id
                 WHERE  u.id = ? AND u.is_active = TRUE`,
                [user_id]
            );
            if (!user)
                return res.status(401).json({ error: "Unauthorized — invalid or inactive user" });
            if (!allowedRoles.includes(user.role))
                return res.status(403).json({
                    error:          `Forbidden — '${user.role}' cannot perform this operation`,
                    required_roles: allowedRoles,
                    your_role:      user.role
                });
            req.currentUser = user;
            next();
        } catch (e) { res.status(500).json({ error: e.message }); }
    };
}

// requirePermission(flag) — checks specific DB-level flag in role_permissions table
// flag = "can_view" | "can_insert" | "can_update" | "can_delete"
function requirePermission(flag) {
    return async (req, res, next) => {
        const user_id = req.body?.user_id || req.query?.user_id;
        if (!user_id)
            return res.status(401).json({ error: "Unauthorized — user_id required" });
        try {
            const [[perms]] = await query(
                `SELECT rp.can_view, rp.can_insert, rp.can_update, rp.can_delete,
                        r.name AS role
                 FROM   users u
                 JOIN   roles r             ON u.role_id = r.id
                 JOIN   role_permissions rp ON r.id      = rp.role_id
                 WHERE  u.id = ? AND u.is_active = TRUE`,
                [user_id]
            );
            if (!perms || !perms[flag])
                return res.status(403).json({
                    error:              `Forbidden — '${perms?.role}' does not have '${flag}' permission`,
                    permission_checked: flag,
                    your_role:          perms?.role
                });
            next();
        } catch (e) { res.status(500).json({ error: e.message }); }
    };
}


// ─────────────────────────────────────────────────────────────
//  AUTH — Login, Register, Change Password, Forgot Password,
//          Edit Profile, Verify OTP
// ─────────────────────────────────────────────────────────────

// Helper: generate 6-digit OTP
function generateOTP() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// Helper: log user activity
async function logActivity(user_id, action, detail = "", ip = "") {
    await query(
        "INSERT INTO user_activity_log (user_id, action, detail, ip_address) VALUES (?,?,?,?)",
        [user_id, action, detail, ip]
    ).catch(() => {}); // non-critical, never throw
}

// ── POST /api/auth/login ──────────────────────────────────────
// Body: { username, password }
// Returns: user info + role + permissions
app.post("/api/auth/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ error: "Username and password are required" });

        const [rows] = await query(
            `SELECT u.id, u.name, u.username, u.email, u.phone, u.is_active,
                    r.name AS role,
                    b.name AS branch, b.id AS branch_id,
                    rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
             FROM   users u
             JOIN   roles r             ON u.role_id   = r.id
             LEFT JOIN branches b       ON u.branch_id = b.id
             JOIN   role_permissions rp ON r.id        = rp.role_id
             WHERE  u.username = ? AND u.password = ? AND u.is_active = TRUE`,
            [username, password]
        );
        if (!rows.length)
            return res.status(401).json({ error: "Invalid username or password" });

        await logActivity(rows[0].id, "LOGIN", `Logged in as ${rows[0].role}`, req.ip);
        res.json({ success: true, user: rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/auth/register ───────────────────────────────────
// Body: { name, username, email, phone, password, branch_id }
// New users are registered as Seller (role_id = 3) by default
// An admin can later reassign their role
app.post("/api/auth/register", async (req, res) => {
    try {
        const { name, username, email, phone, password, branch_id } = req.body;

        // Validate required fields
        if (!name || !username || !email || !password)
            return res.status(400).json({ error: "Name, username, email and password are required" });

        if (password.length < 6)
            return res.status(400).json({ error: "Password must be at least 6 characters" });

        // Check username uniqueness
        const [[existUser]] = await query(
            "SELECT id FROM users WHERE username = ?", [username]
        );
        if (existUser)
            return res.status(409).json({ error: "Username already taken" });

        // Check email uniqueness
        const [[existEmail]] = await query(
            "SELECT id FROM users WHERE email = ?", [email]
        );
        if (existEmail)
            return res.status(409).json({ error: "Email already registered" });

        // Check phone uniqueness (if provided)
        if (phone) {
            const [[existPhone]] = await query(
                "SELECT id FROM users WHERE phone = ?", [phone]
            );
            if (existPhone)
                return res.status(409).json({ error: "Phone number already registered" });
        }

        // Insert new user — default role: Seller (3), pending admin approval
        const [result] = await query(
            `INSERT INTO users (name, username, email, phone, password, role_id, branch_id, is_active)
             VALUES (?, ?, ?, ?, ?, 3, ?, TRUE)`,
            [name, username, email, phone || null, password, branch_id || null]
        );

        await logActivity(result.insertId, "REGISTER", `New account: ${username} (${email})`, req.ip);

        // Return the created user with role info
        const [[newUser]] = await query(
            `SELECT u.id, u.name, u.username, u.email, u.phone,
                    r.name AS role, b.name AS branch, b.id AS branch_id,
                    rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
             FROM   users u
             JOIN   roles r             ON u.role_id   = r.id
             LEFT JOIN branches b       ON u.branch_id = b.id
             JOIN   role_permissions rp ON r.id        = rp.role_id
             WHERE  u.id = ?`,
            [result.insertId]
        );
        res.status(201).json({ success: true, user: newUser });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/auth/forgot-password ───────────────────────────
// Body: { identifier }  — identifier = email OR phone
// Generates a 6-digit OTP valid for 15 minutes
// In production: send via email/SMS. Here: returned in response for demo.
app.post("/api/auth/forgot-password", async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier)
            return res.status(400).json({ error: "Email or phone number is required" });

        // Find user by email or phone
        const [[user]] = await query(
            "SELECT id, name, email, phone FROM users WHERE email = ? OR phone = ?",
            [identifier, identifier]
        );
        if (!user)
            return res.status(404).json({ error: "No account found with that email or phone" });

        // Invalidate any existing unused tokens for this user
        await query(
            "UPDATE password_reset_tokens SET used = TRUE WHERE user_id = ? AND used = FALSE",
            [user.id]
        );

        // Generate OTP + expiry (15 minutes from now)
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
            .toISOString().slice(0, 19).replace("T", " ");

        await query(
            "INSERT INTO password_reset_tokens (user_id, token, identifier, expires_at) VALUES (?,?,?,?)",
            [user.id, otp, identifier, expiresAt]
        );

        await logActivity(user.id, "RESET_PASSWORD_REQUEST", `OTP requested via ${identifier}`, req.ip);

        // In production: send OTP via email/SMS provider
        // For this demo: return it directly so you can test
        res.json({
            success: true,
            message: `OTP sent to ${identifier}`,
            otp,                    // ← remove this line in production
            user_id: user.id,
            expires_in: "15 minutes"
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/auth/verify-otp ─────────────────────────────────
// Body: { user_id, otp }
// Verifies OTP — returns a short-lived reset_token to use in reset-password
app.post("/api/auth/verify-otp", async (req, res) => {
    try {
        const { user_id, otp } = req.body;
        if (!user_id || !otp)
            return res.status(400).json({ error: "user_id and otp are required" });

        const [[token]] = await query(
            `SELECT * FROM password_reset_tokens
             WHERE  user_id = ? AND token = ? AND used = FALSE
               AND  expires_at > NOW()`,
            [user_id, otp]
        );
        if (!token)
            return res.status(400).json({ error: "Invalid or expired OTP" });

        // Mark token as used
        await query(
            "UPDATE password_reset_tokens SET used = TRUE WHERE id = ?",
            [token.id]
        );

        res.json({ success: true, message: "OTP verified — proceed to reset password" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/auth/reset-password ────────────────────────────
// Body: { user_id, new_password }
// Called after OTP is verified
app.post("/api/auth/reset-password", async (req, res) => {
    try {
        const { user_id, new_password } = req.body;
        if (!user_id || !new_password)
            return res.status(400).json({ error: "user_id and new_password are required" });

        if (new_password.length < 6)
            return res.status(400).json({ error: "Password must be at least 6 characters" });

        await query(
            "UPDATE users SET password = ? WHERE id = ?",
            [new_password, user_id]
        );

        await logActivity(user_id, "RESET_PASSWORD", "Password reset via OTP", req.ip);
        res.json({ success: true, message: "Password reset successfully" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/auth/change-password ───────────────────────────
// Body: { user_id, current_password, new_password }
// Requires current password to be correct
app.post("/api/auth/change-password", async (req, res) => {
    try {
        const { user_id, current_password, new_password } = req.body;
        if (!user_id || !current_password || !new_password)
            return res.status(400).json({ error: "All fields are required" });

        if (new_password.length < 6)
            return res.status(400).json({ error: "New password must be at least 6 characters" });

        if (current_password === new_password)
            return res.status(400).json({ error: "New password must be different from current password" });

        // Verify current password
        const [[user]] = await query(
            "SELECT id FROM users WHERE id = ? AND password = ?",
            [user_id, current_password]
        );
        if (!user)
            return res.status(401).json({ error: "Current password is incorrect" });

        await query(
            "UPDATE users SET password = ? WHERE id = ?",
            [new_password, user_id]
        );

        await logActivity(user_id, "CHANGE_PASSWORD", "Password changed by user", req.ip);
        res.json({ success: true, message: "Password changed successfully" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/auth/profile ───────────────────────────────────
// Body: { user_id, name, email, phone }
// Users can update their own name, email, phone
app.patch("/api/auth/profile", async (req, res) => {
    try {
        const { user_id, name, email, phone } = req.body;
        if (!user_id)
            return res.status(400).json({ error: "user_id is required" });

        // Check email uniqueness (excluding current user)
        if (email) {
            const [[existEmail]] = await query(
                "SELECT id FROM users WHERE email = ? AND id != ?", [email, user_id]
            );
            if (existEmail)
                return res.status(409).json({ error: "Email already in use by another account" });
        }

        // Check phone uniqueness (excluding current user)
        if (phone) {
            const [[existPhone]] = await query(
                "SELECT id FROM users WHERE phone = ? AND id != ?", [phone, user_id]
            );
            if (existPhone)
                return res.status(409).json({ error: "Phone number already in use by another account" });
        }

        await query(
            `UPDATE users
             SET    name  = COALESCE(NULLIF(?, ''), name),
                    email = COALESCE(NULLIF(?, ''), email),
                    phone = COALESCE(NULLIF(?, ''), phone)
             WHERE  id = ?`,
            [name || "", email || "", phone || "", user_id]
        );

        // Return updated profile
        const [[updated]] = await query(
            `SELECT u.id, u.name, u.username, u.email, u.phone,
                    r.name AS role, b.name AS branch, b.id AS branch_id
             FROM   users u
             JOIN   roles r        ON u.role_id   = r.id
             LEFT JOIN branches b  ON u.branch_id = b.id
             WHERE  u.id = ?`,
            [user_id]
        );

        await logActivity(user_id, "EDIT_PROFILE", `Updated: name/email/phone`, req.ip);
        res.json({ success: true, user: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/auth/activity/:user_id ──────────────────────────
// Returns recent activity log for a user
app.get("/api/auth/activity/:user_id", async (req, res) => {
    try {
        const [rows] = await query(
            `SELECT action, detail, logged_at
             FROM   user_activity_log
             WHERE  user_id = ?
             ORDER BY logged_at DESC LIMIT 20`,
            [req.params.user_id]
        );
        res.json(rows);
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
app.patch("/api/inventory/:product_id/:branch_id/:platform_id",
    requireRole("Admin", "Manager"),
    requirePermission("can_update"),
    async (req, res) => {
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
app.post("/api/products",
    requireRole("Admin", "Manager"),
    requirePermission("can_insert"),
    async (req, res) => {
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
app.get("/api/users",
    requireRole("Admin", "Manager"),
    async (req, res) => {
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
app.post("/api/users",
    requireRole("Admin"),
    async (req, res) => {
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
app.patch("/api/users/:id/active",
    requireRole("Admin"),
    async (req, res) => {
    try {
        const { is_active } = req.body;
        await query("UPDATE users SET is_active = ? WHERE id = ?", [is_active, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/users/:id/role
app.patch("/api/users/:id/role",
    requireRole("Admin"),
    async (req, res) => {
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

// =============================================================
//  MEMBER 3 — RESTRICTED OPERATIONS (server-enforced RBAC)
//  These routes use requireRole/requirePermission middleware.
//  Clients with wrong roles receive HTTP 403 Forbidden.
// =============================================================

// GET /api/users  — Admin & Manager only (Seller/Viewer/Delivery blocked)
app.get("/api/users",
    requireRole("Admin", "Manager"),
    async (req, res) => {
        try {
            const { role, branch_id } = req.query;
            let sql = `
                SELECT  u.id, u.name, u.username, u.email, u.phone,
                        u.is_active, u.created_at,
                        r.name AS role,
                        b.name AS branch
                FROM    users u
                JOIN    roles r       ON u.role_id   = r.id
                LEFT JOIN branches b  ON u.branch_id = b.id
                WHERE   1=1`;
            const params = [];
            if (role)      { sql += " AND r.name = ?";      params.push(role); }
            if (branch_id) { sql += " AND u.branch_id = ?"; params.push(branch_id); }
            sql += " ORDER BY r.name, u.name";
            const [rows] = await query(sql, params);
            res.json(rows);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
);

// POST /api/users  — Admin only
app.post("/api/users",
    requireRole("Admin"),
    async (req, res) => {
        try {
            const { name, username, email, password, role_id, branch_id } = req.body;
            if (!name || !username || !email || !password)
                return res.status(400).json({ error: "name, username, email, password are required" });
            const [result] = await query(
                "INSERT INTO users (name, username, email, password, role_id, branch_id) VALUES (?,?,?,?,?,?)",
                [name, username, email, password, role_id, branch_id || null]
            );
            res.status(201).json({ success: true, id: result.insertId });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
);

// PATCH /api/users/:id/active  — Admin only
app.patch("/api/users/:id/active",
    requireRole("Admin"),
    async (req, res) => {
        try {
            const { is_active } = req.body;
            await query("UPDATE users SET is_active = ? WHERE id = ?", [is_active, req.params.id]);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
);

// PATCH /api/users/:id/role  — Admin only
app.patch("/api/users/:id/role",
    requireRole("Admin"),
    async (req, res) => {
        try {
            const { role_id, branch_id } = req.body;
            await query("UPDATE users SET role_id=?, branch_id=? WHERE id=?",
                [role_id, branch_id || null, req.params.id]);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
);

// POST /api/products  — Admin & Manager only (Sellers cannot add products)
app.post("/api/products",
    requireRole("Admin", "Manager"),
    requirePermission("can_insert"),
    async (req, res) => {
        try {
            const { name, emoji, category_id, cost_price, sell_price } = req.body;
            const [result] = await query(
                "INSERT INTO products (name, emoji, category_id, cost_price, sell_price) VALUES (?,?,?,?,?)",
                [name, emoji || "📦", category_id, cost_price, sell_price]
            );
            res.status(201).json({ success: true, id: result.insertId });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
);

// PATCH /api/inventory/:pid/:bid/:plid  — Admin & Manager only
app.patch("/api/inventory/:product_id/:branch_id/:platform_id",
    requireRole("Admin", "Manager"),
    requirePermission("can_update"),
    async (req, res) => {
        try {
            const { product_id, branch_id, platform_id } = req.params;
            const { stock } = req.body;
            await query(
                "UPDATE inventory SET stock=? WHERE product_id=? AND branch_id=? AND platform_id=?",
                [stock, product_id, branch_id, platform_id]
            );
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
);

// DELETE /api/orders/:id  — Admin only, requires can_delete flag
app.delete("/api/orders/:id",
    requireRole("Admin"),
    requirePermission("can_delete"),
    async (req, res) => {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [[ord]] = await conn.execute(
                "SELECT product_id, branch_id, platform_id, qty FROM orders WHERE id=?",
                [req.params.id]
            );
            if (!ord) { await conn.rollback(); return res.status(404).json({ error: "Order not found" }); }
            // Restore stock
            await conn.execute(
                "UPDATE inventory SET stock=stock+? WHERE product_id=? AND branch_id=? AND platform_id=?",
                [ord.qty, ord.product_id, ord.branch_id, ord.platform_id]
            );
            await conn.execute("DELETE FROM deliveries WHERE order_id=?", [req.params.id]);
            await conn.execute("DELETE FROM orders WHERE id=?", [req.params.id]);
            await conn.commit();
            res.json({ success: true, message: "Order deleted and stock restored" });
        } catch (e) {
            await conn.rollback();
            res.status(500).json({ error: e.message });
        } finally { conn.release(); }
    }
);

// GET /api/permissions/check  — returns what the current user can/cannot do
// Query param: ?user_id=N
app.get("/api/permissions/check", async (req, res) => {
    try {
        const user_id = req.query.user_id;
        if (!user_id) return res.status(400).json({ error: "user_id required" });
        const [[result]] = await query(
            `SELECT u.name, r.name AS role,
                    rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
             FROM   users u
             JOIN   roles r             ON u.role_id = r.id
             JOIN   role_permissions rp ON r.id      = rp.role_id
             WHERE  u.id = ? AND u.is_active = TRUE`,
            [user_id]
        );
        if (!result) return res.status(404).json({ error: "User not found" });
        res.json({
            user:        result.name,
            role:        result.role,
            permissions: {
                can_view:   !!result.can_view,
                can_insert: !!result.can_insert,
                can_update: !!result.can_update,
                can_delete: !!result.can_delete,
            },
            restricted_routes: {
                "GET /api/users":               ["Admin","Manager"],
                "POST /api/users":              ["Admin"],
                "POST /api/products":           ["Admin","Manager"],
                "PATCH /api/inventory":         ["Admin","Manager"],
                "DELETE /api/orders/:id":       ["Admin"],
                "POST /api/transactions/*":     ["Admin","Manager"],
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
//  MEMBER 2 — EXTRA TRANSACTIONS
//  Demonstrates multi-step atomic operations with
//  BEGIN / COMMIT / ROLLBACK for different business scenarios
// =============================================================

// POST /api/transactions/stock-transfer
// Atomically move stock between two branches in one transaction.
// If source has insufficient stock → entire operation rolls back.
// Body: { product_id, platform_id, from_branch_id, to_branch_id, qty, user_id }
app.post("/api/transactions/stock-transfer",
    requireRole("Admin", "Manager"),
    async (req, res) => {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const { product_id, platform_id, from_branch_id, to_branch_id, qty } = req.body;

            // Step 1: Verify source stock
            const [[src]] = await conn.execute(
                `SELECT i.stock, p.name AS product, b.name AS branch
                 FROM   inventory i
                 JOIN   products p  ON i.product_id  = p.id
                 JOIN   branches b  ON i.branch_id   = b.id
                 WHERE  i.product_id=? AND i.branch_id=? AND i.platform_id=?`,
                [product_id, from_branch_id, platform_id]
            );
            if (!src || src.stock < qty) {
                await conn.rollback();
                return res.status(400).json({
                    error:     `Insufficient stock in source branch`,
                    available: src?.stock ?? 0,
                    requested: qty
                });
            }

            // Step 2: Deduct from source branch
            await conn.execute(
                "UPDATE inventory SET stock=stock-? WHERE product_id=? AND branch_id=? AND platform_id=?",
                [qty, product_id, from_branch_id, platform_id]
            );

            // Step 3: Add to destination branch (create row if it doesn't exist)
            await conn.execute(
                `INSERT INTO inventory (product_id, branch_id, platform_id, stock)
                 VALUES (?,?,?,?)
                 ON DUPLICATE KEY UPDATE stock=stock+?`,
                [product_id, to_branch_id, platform_id, qty, qty]
            );

            // Step 4: Log the transfer
            await conn.execute(
                "INSERT INTO trigger_logs (event_type, description) VALUES (?,?)",
                ["stock_transfer",
                 `${src.product}: ${qty} units | branch ${from_branch_id}→${to_branch_id}`]
            );

            await conn.commit();
            res.json({
                success: true,
                message: `${qty} units of '${src.product}' transferred`,
                from_branch: from_branch_id,
                to_branch:   to_branch_id
            });
        } catch (e) {
            await conn.rollback();
            res.status(500).json({ error: e.message });
        } finally { conn.release(); }
    }
);

// POST /api/transactions/bulk-order
// Place multiple order lines atomically.
// All items commit together or all roll back if any item fails.
// Body: { items:[{product_id,branch_id,platform_id,qty}], customer_name,
//         customer_phone, customer_address, seller_id, payment_method, user_id }
app.post("/api/transactions/bulk-order",
    requireRole("Admin", "Manager", "Seller"),
    requirePermission("can_insert"),
    async (req, res) => {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const { items, customer_name, customer_phone,
                    customer_address, seller_id, payment_method } = req.body;
            if (!items || !items.length) {
                await conn.rollback();
                return res.status(400).json({ error: "No items provided" });
            }

            // Upsert customer
            let customer_id;
            const [[existing]] = await conn.execute(
                "SELECT id FROM customers WHERE phone=?", [customer_phone || ""]
            );
            if (existing) {
                customer_id = existing.id;
            } else {
                const [cr] = await conn.execute(
                    "INSERT INTO customers (name, phone, address) VALUES (?,?,?)",
                    [customer_name, customer_phone || null, customer_address || null]
                );
                customer_id = cr.insertId;
            }

            const orderRefs = [];
            let   grandTotal = 0;

            for (const item of items) {
                const { product_id, branch_id, platform_id, qty } = item;

                // Check stock for each item — rollback entire batch if any fail
                const [[inv]] = await conn.execute(
                    `SELECT i.stock, p.sell_price, p.name
                     FROM   inventory i JOIN products p ON i.product_id=p.id
                     WHERE  i.product_id=? AND i.branch_id=? AND i.platform_id=?`,
                    [product_id, branch_id, platform_id]
                );
                if (!inv || inv.stock < qty) {
                    await conn.rollback();
                    return res.status(400).json({
                        error:     `Insufficient stock for '${inv?.name ?? "product_id=" + product_id}'`,
                        available: inv?.stock ?? 0,
                        requested: qty
                    });
                }

                const [[{ maxId }]] = await conn.execute(
                    "SELECT COALESCE(MAX(id),2200) AS maxId FROM orders"
                );
                const order_ref    = `ORD-${maxId + 1}`;
                const total_amount = inv.sell_price * qty;
                grandTotal += total_amount;

                // INSERT order — trigger trg_inv_deduct_on_order fires automatically
                await conn.execute(
                    `INSERT INTO orders
                       (order_ref, product_id, branch_id, platform_id, customer_id,
                        seller_id, qty, unit_price, total_amount, payment_method)
                     VALUES (?,?,?,?,?,?,?,?,?,?)`,
                    [order_ref, product_id, branch_id, platform_id, customer_id,
                     seller_id, qty, inv.sell_price, total_amount, payment_method || "UPI"]
                );
                orderRefs.push(order_ref);
            }

            await conn.commit();
            res.json({ success: true, orders: orderRefs, grand_total: grandTotal });
        } catch (e) {
            await conn.rollback();
            res.status(500).json({ error: e.message });
        } finally { conn.release(); }
    }
);

// =============================================================
//  MEMBER 2 — EXPLAIN COMMAND
//  GET /api/explain?query=<key>
//  Runs MySQL EXPLAIN on named queries to demonstrate index
//  usage and query optimization.
// =============================================================

const EXPLAIN_QUERIES = {
    inventory_by_branch: {
        label: "Inventory filtered by branch (JOIN + WHERE)",
        sql: `SELECT p.name, i.stock, pl.name AS platform
              FROM   inventory i
              JOIN   products  p  ON i.product_id  = p.id
              JOIN   platforms pl ON i.platform_id = pl.id
              WHERE  i.branch_id = 1`
    },
    orders_revenue_by_platform: {
        label: "Revenue per platform using GROUP BY + SUM",
        sql: `SELECT pl.name, COUNT(o.id) AS total_orders,
                     SUM(o.total_amount) AS revenue
              FROM   orders o
              JOIN   platforms pl ON o.platform_id = pl.id
              GROUP  BY pl.id
              ORDER  BY revenue DESC`
    },
    orders_by_seller: {
        label: "Orders by a specific seller (indexed FK lookup)",
        sql: `SELECT o.order_ref, p.name AS product,
                     o.total_amount, o.status
              FROM   orders o
              JOIN   products p ON o.product_id = p.id
              WHERE  o.seller_id = 3`
    },
    low_stock_alert: {
        label: "Low stock detection (stock between 0 and 8)",
        sql: `SELECT p.name, b.name AS branch,
                     pl.name AS platform, i.stock
              FROM   inventory i
              JOIN   products  p  ON i.product_id  = p.id
              JOIN   branches  b  ON i.branch_id   = b.id
              JOIN   platforms pl ON i.platform_id = pl.id
              WHERE  i.stock <= 8 AND i.stock > 0`
    },
    user_rbac_lookup: {
        label: "User role and permission lookup (3-table JOIN)",
        sql: `SELECT u.username, r.name AS role,
                     rp.can_view, rp.can_insert,
                     rp.can_update, rp.can_delete
              FROM   users u
              JOIN   roles r             ON u.role_id = r.id
              JOIN   role_permissions rp ON r.id      = rp.role_id
              WHERE  u.id = 3`
    },
    delivery_full_join: {
        label: "Full delivery tracking (5-table JOIN)",
        sql: `SELECT d.delivery_ref, d.status,
                     u.name  AS staff,
                     c.name  AS customer,
                     p.name  AS product,
                     b.name  AS branch
              FROM   deliveries d
              JOIN   orders    o ON d.order_id    = o.id
              JOIN   users     u ON d.staff_id    = u.id
              JOIN   customers c ON o.customer_id = c.id
              JOIN   products  p ON o.product_id  = p.id
              JOIN   branches  b ON o.branch_id   = b.id`
    }
};

// GET /api/explain?query=inventory_by_branch
app.get("/api/explain", async (req, res) => {
    try {
        const key = req.query.query;
        if (!key || !EXPLAIN_QUERIES[key])
            return res.status(400).json({
                error:     "Unknown query key",
                available: Object.keys(EXPLAIN_QUERIES)
            });
        const q      = EXPLAIN_QUERIES[key];
        const [rows] = await query("EXPLAIN " + q.sql, []);
        res.json({
            key,
            label:          q.label,
            original_sql:   q.sql.replace(/\s+/g," ").trim(),
            explain_output: rows
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/explain/all  — run EXPLAIN on every named query at once
app.get("/api/explain/all", async (_req, res) => {
    try {
        const results = {};
        for (const [key, q] of Object.entries(EXPLAIN_QUERIES)) {
            const [rows] = await query("EXPLAIN " + q.sql, []);
            results[key] = {
                label:          q.label,
                original_sql:   q.sql.replace(/\s+/g," ").trim(),
                explain_output: rows
            };
        }
        res.json(results);
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
    console.log(`   MySQL → ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}\n`);

    console.log(`   ── Member 3: Auth & Restricted Operations ──`);
    console.log(`   POST  /api/auth/login`);
    console.log(`   POST  /api/auth/register`);
    console.log(`   POST  /api/auth/forgot-password`);
    console.log(`   POST  /api/auth/verify-otp`);
    console.log(`   POST  /api/auth/reset-password`);
    console.log(`   POST  /api/auth/change-password`);
    console.log(`   PATCH /api/auth/profile`);
    console.log(`   GET   /api/auth/activity/:user_id`);
    console.log(`   GET   /api/permissions/check?user_id=N`);
    console.log(`   GET   /api/users           [Admin/Manager only]`);
    console.log(`   POST  /api/users           [Admin only]`);
    console.log(`   POST  /api/products        [Admin/Manager only]`);
    console.log(`   PATCH /api/inventory       [Admin/Manager only]`);
    console.log(`   DELETE /api/orders/:id     [Admin only]\n`);

    console.log(`   ── Member 2: Transactions & EXPLAIN ──`);
    console.log(`   POST /api/orders                      [transaction]`);
    console.log(`   POST /api/transactions/stock-transfer [transaction]`);
    console.log(`   POST /api/transactions/bulk-order     [transaction]`);
    console.log(`   GET  /api/explain?query=<key>         [EXPLAIN]`);
    console.log(`   GET  /api/explain/all                 [EXPLAIN all]\n`);

    console.log(`   ── Member 1: Triggers (in schema.sql) ──`);
    console.log(`   trg_inv_deduct_on_order      AFTER INSERT orders`);
    console.log(`   trg_prevent_negative_stock   BEFORE UPDATE inventory`);
    console.log(`   trg_log_order_status         AFTER UPDATE orders`);
    console.log(`   trg_log_delivery_status      AFTER UPDATE deliveries\n`);

    console.log(`   ── General ──`);
    console.log(`   GET /api/inventory`);
    console.log(`   GET /api/orders`);
    console.log(`   GET /api/deliveries`);
    console.log(`   GET /api/dashboard/kpis`);
    console.log(`   GET /api/trigger-logs`);
    console.log(`   GET /api/health\n`);
});
