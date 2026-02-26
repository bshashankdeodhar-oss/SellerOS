-- ============================================================
--  SellerOS — MySQL Database Schema
--  Run this file once to set up your entire database.
--  Command: mysql -u root -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS selleros CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE selleros;

-- ─────────────────────────────────────────────────────────────
--  1. BRANCHES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    city        VARCHAR(100) NOT NULL,
    state       VARCHAR(100) NOT NULL,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────
--  2. PLATFORMS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platforms (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,
    is_active   BOOLEAN DEFAULT TRUE
);

-- ─────────────────────────────────────────────────────────────
--  3. ROLES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        ENUM('Admin','Manager','Seller','Viewer','Delivery') NOT NULL UNIQUE
);

-- ─────────────────────────────────────────────────────────────
--  4. ROLE PERMISSIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    role_id         INT NOT NULL,
    can_view        BOOLEAN DEFAULT TRUE,
    can_insert      BOOLEAN DEFAULT FALSE,
    can_update      BOOLEAN DEFAULT FALSE,
    can_delete      BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- ─────────────────────────────────────────────────────────────
--  5. USERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    email       VARCHAR(150) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,           -- store hashed passwords
    role_id     INT          NOT NULL,
    branch_id   INT,                             -- NULL means all branches (Admin)
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id)    REFERENCES roles(id),
    FOREIGN KEY (branch_id)  REFERENCES branches(id)
);

-- ─────────────────────────────────────────────────────────────
--  6. CATEGORIES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) NOT NULL UNIQUE
);

-- ─────────────────────────────────────────────────────────────
--  7. PRODUCTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    emoji       VARCHAR(10)  DEFAULT '📦',
    category_id INT          NOT NULL,
    cost_price  DECIMAL(10,2) NOT NULL,
    sell_price  DECIMAL(10,2) NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- ─────────────────────────────────────────────────────────────
--  8. INVENTORY  (product × branch × platform)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    product_id  INT NOT NULL,
    branch_id   INT NOT NULL,
    platform_id INT NOT NULL,
    stock       INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_inv (product_id, branch_id, platform_id),
    FOREIGN KEY (product_id)  REFERENCES products(id),
    FOREIGN KEY (branch_id)   REFERENCES branches(id),
    FOREIGN KEY (platform_id) REFERENCES platforms(id)
);

-- ─────────────────────────────────────────────────────────────
--  9. CUSTOMERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    phone   VARCHAR(20),
    email   VARCHAR(150),
    address TEXT
);

-- ─────────────────────────────────────────────────────────────
--  10. ORDERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    order_ref       VARCHAR(20) NOT NULL UNIQUE,   -- e.g. ORD-2201
    product_id      INT         NOT NULL,
    branch_id       INT         NOT NULL,
    platform_id     INT         NOT NULL,
    customer_id     INT         NOT NULL,
    seller_id       INT         NOT NULL,           -- user who placed order
    qty             INT         NOT NULL DEFAULT 1,
    unit_price      DECIMAL(10,2) NOT NULL,
    total_amount    DECIMAL(10,2) NOT NULL,
    payment_method  ENUM('UPI','Card','COD','Store Pickup') DEFAULT 'UPI',
    status          ENUM('Pending','Processing','Shipped','Delivered','Cancelled') DEFAULT 'Pending',
    notes           TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id)  REFERENCES products(id),
    FOREIGN KEY (branch_id)   REFERENCES branches(id),
    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (seller_id)   REFERENCES users(id)
);

-- ─────────────────────────────────────────────────────────────
--  11. DELIVERIES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    delivery_ref    VARCHAR(20) NOT NULL UNIQUE,   -- e.g. DEL-881
    order_id        INT         NOT NULL UNIQUE,
    staff_id        INT         NOT NULL,           -- delivery user
    status          ENUM('Pending','Picked Up','Out for Delivery','Delivered') DEFAULT 'Pending',
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id)  REFERENCES orders(id),
    FOREIGN KEY (staff_id)  REFERENCES users(id)
);

-- ─────────────────────────────────────────────────────────────
--  12. TRIGGER LOGS  (auto-populated by triggers)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trigger_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    event_type  VARCHAR(100) NOT NULL,
    description TEXT,
    logged_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────
--  TRIGGERS
-- ─────────────────────────────────────────────────────────────

DELIMITER $$

-- T1: Deduct inventory when order is placed
DROP TRIGGER IF EXISTS trg_inv_deduct_on_order$$
CREATE TRIGGER trg_inv_deduct_on_order
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
    UPDATE inventory
    SET    stock = stock - NEW.qty
    WHERE  product_id  = NEW.product_id
      AND  branch_id   = NEW.branch_id
      AND  platform_id = NEW.platform_id;

    INSERT INTO trigger_logs (event_type, description)
    VALUES (
        'inv_update_on_order',
        CONCAT('Stock reduced by ', NEW.qty, ' for product_id=', NEW.product_id,
               ' branch_id=', NEW.branch_id, ' (', NEW.order_ref, ')')
    );
END$$

-- T2: Prevent negative stock (safety guard)
DROP TRIGGER IF EXISTS trg_prevent_negative_stock$$
CREATE TRIGGER trg_prevent_negative_stock
BEFORE UPDATE ON inventory
FOR EACH ROW
BEGIN
    IF NEW.stock < 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Stock cannot go below zero.';
    END IF;
END$$

-- T3: Log order status changes
DROP TRIGGER IF EXISTS trg_log_order_status$$
CREATE TRIGGER trg_log_order_status
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO trigger_logs (event_type, description)
        VALUES (
            'order_status_change',
            CONCAT(NEW.order_ref, ' status changed: ', OLD.status, ' → ', NEW.status)
        );
    END IF;
END$$

-- T4: Log delivery status changes
DROP TRIGGER IF EXISTS trg_log_delivery_status$$
CREATE TRIGGER trg_log_delivery_status
AFTER UPDATE ON deliveries
FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO trigger_logs (event_type, description)
        VALUES (
            'delivery_status_change',
            CONCAT(NEW.delivery_ref, ' → ', NEW.status)
        );
    END IF;
END$$

DELIMITER ;

-- ─────────────────────────────────────────────────────────────
--  SEED DATA
-- ─────────────────────────────────────────────────────────────

-- Branches
INSERT INTO branches (name, city, state) VALUES
    ('Mumbai Central',  'Mumbai',    'Maharashtra'),
    ('Delhi NCR',       'Delhi',     'Delhi'),
    ('Bangalore South', 'Bengaluru', 'Karnataka'),
    ('Chennai',         'Chennai',   'Tamil Nadu');

-- Platforms
INSERT INTO platforms (name) VALUES
    ('Amazon'), ('Flipkart'), ('Own Website'), ('Offline');

-- Roles
INSERT INTO roles (name) VALUES
    ('Admin'), ('Manager'), ('Seller'), ('Viewer'), ('Delivery');

-- Role permissions
INSERT INTO role_permissions (role_id, can_view, can_insert, can_update, can_delete) VALUES
    (1, TRUE,  TRUE,  TRUE,  TRUE),   -- Admin
    (2, TRUE,  TRUE,  TRUE,  FALSE),  -- Manager
    (3, TRUE,  TRUE,  FALSE, FALSE),  -- Seller
    (4, TRUE,  FALSE, FALSE, FALSE),  -- Viewer
    (5, TRUE,  FALSE, TRUE,  FALSE);  -- Delivery (can update delivery status)

-- Users  (passwords stored as plaintext here for demo — hash in production)
INSERT INTO users (name, username, email, password, role_id, branch_id) VALUES
    ('Arjun Kumar',  'arjun',   'arjun@selleros.in',  'admin123',    1, NULL),
    ('Preeti Rao',   'preeti',  'preeti@selleros.in', 'manager123',  2, 1),
    ('Rahul Sharma', 'rahul',   'rahul@selleros.in',  'seller123',   3, 1),
    ('Neha Gupta',   'neha',    'neha@selleros.in',   'viewer123',   4, 2),
    ('Karan Patil',  'karan',   'karan@selleros.in',  'delivery123', 5, 1),
    ('Sunita Joshi', 'sunita',  'sunita@selleros.in', 'seller123',   3, 2),
    ('Amit Yadav',   'amit',    'amit@selleros.in',   'delivery123', 5, 2),
    ('Vijay S.',     'vijay',   'vijay@selleros.in',  'manager123',  2, 3);

-- Categories
INSERT INTO categories (name) VALUES
    ('Electronics'), ('Clothing'), ('Home & Kitchen'), ('Sports'), ('Books');

-- Products
INSERT INTO products (name, emoji, category_id, cost_price, sell_price) VALUES
    ('Wireless Headphones', '🎧', 1, 1200.00, 2499.00),
    ('Running Shoes',       '👟', 4, 1400.00, 3199.00),
    ('Cotton T-Shirt',      '👕', 2,  300.00,  799.00),
    ('Smart Watch',         '⌚', 1, 4000.00, 7999.00),
    ('Yoga Mat',            '🧘', 4,  500.00, 1299.00),
    ('Java Programming',    '📚', 5,  200.00,  549.00),
    ('Coffee Maker',        '☕', 3, 2000.00, 4499.00),
    ('Denim Jacket',        '🧥', 2,  900.00, 2199.00),
    ('Bluetooth Speaker',   '🔊', 1,  800.00, 1899.00),
    ('Steel Water Bottle',  '🍶', 3,  250.00,  699.00);

-- Inventory  (product_id, branch_id, platform_id, stock)
INSERT INTO inventory (product_id, branch_id, platform_id, stock) VALUES
    (1, 1, 1, 34), (1, 1, 2, 20),
    (2, 2, 1,  8), (2, 2, 3, 12),
    (3, 1, 2,120), (3, 1, 4, 50),
    (4, 3, 1,  0),
    (5, 4, 3,  5), (5, 4, 4, 10),
    (6, 1, 1, 42), (6, 1, 2, 30), (6, 1, 3, 15),
    (7, 2, 1, 15), (7, 2, 2, 10),
    (8, 3, 2,  3), (8, 3, 4,  8),
    (9, 4, 1, 22), (9, 4, 3, 18),
    (10,1, 1, 88), (10,1, 2, 60), (10,1, 3, 40), (10,1, 4, 30);

-- Customers
INSERT INTO customers (name, phone, email, address) VALUES
    ('Priya Mehta',    '9876543210', 'priya@email.com',   'Flat 12B, Sunshine Towers, Andheri West, Mumbai'),
    ('Aakash Joshi',   '9123456780', 'aakash@email.com',  'B-45, Lajpat Nagar II, New Delhi'),
    ('Neha Singh',     '9988776655', 'nsingh@email.com',  '22 Koramangala 5th Block, Bengaluru'),
    ('Ravi Kumar',     '9654321098', 'ravi@email.com',    'Shop 4, Linking Road, Bandra, Mumbai'),
    ('Kavya Reddy',    '9012345678', 'kavya@email.com',   'Plot 9, Anna Nagar East, Chennai'),
    ('Aryan Malhotra', '9876012345', 'aryan@email.com',   'T-Nagar, Chennai');

-- Orders
INSERT INTO orders (order_ref, product_id, branch_id, platform_id, customer_id, seller_id, qty, unit_price, total_amount, payment_method, status) VALUES
    ('ORD-2205', 1, 1, 1, 1, 3, 1, 2499.00,  2499.00, 'UPI',          'Shipped'),
    ('ORD-2204', 7, 2, 2, 2, 3, 1, 4499.00,  4499.00, 'Card',         'Processing'),
    ('ORD-2203', 2, 2, 3, 2, 3, 1, 3199.00,  3199.00, 'UPI',          'Pending'),
    ('ORD-2202', 4, 3, 1, 3, 3, 1, 7999.00,  7999.00, 'Card',         'Delivered'),
    ('ORD-2201', 3, 1, 4, 4, 3, 3,  799.00,  2397.00, 'COD',          'Delivered'),
    ('ORD-2200', 5, 4, 3, 5, 3, 1, 1299.00,  1299.00, 'UPI',          'Shipped'),
    ('ORD-2199', 9, 4, 1, 6, 3, 1, 1899.00,  1899.00, 'UPI',          'Processing'),
    ('ORD-2198', 10,1, 2, 1, 3, 5,  699.00,  3495.00, 'Card',         'Delivered');

-- Deliveries
INSERT INTO deliveries (delivery_ref, order_id, staff_id, status) VALUES
    ('DEL-881', 1, 5, 'Out for Delivery'),
    ('DEL-879', 2, 7, 'Picked Up'),
    ('DEL-878', 6, 5, 'Delivered'),
    ('DEL-875', 7, 5, 'Out for Delivery'),
    ('DEL-870', 8, 5, 'Delivered');
