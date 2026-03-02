-- ============================================================
--  SellerOS — Customer Schema Migration
--  Run AFTER schema.sql AND schema_auth.sql
--  Command: mysql -u root -p selleros < schema_customer.sql
-- ============================================================

USE selleros;

-- ─────────────────────────────────────────────────────────────
--  CUSTOMER ACCOUNTS  (separate from staff users table)
--  Customers register on the shopping site with email/phone
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_accounts (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(150) UNIQUE,
    phone           VARCHAR(20)  UNIQUE,
    password        VARCHAR(255) NOT NULL,
    is_active       BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────
--  CUSTOMER ADDRESSES  (multiple saved addresses per customer)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_addresses (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT          NOT NULL,
    label           VARCHAR(50)  DEFAULT 'Home',   -- Home, Work, Other
    name            VARCHAR(100) NOT NULL,
    phone           VARCHAR(20),
    line1           VARCHAR(200) NOT NULL,
    line2           VARCHAR(200),
    city            VARCHAR(100) NOT NULL,
    state           VARCHAR(100) NOT NULL,
    pincode         VARCHAR(10)  NOT NULL,
    is_default      BOOLEAN      DEFAULT FALSE,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────
--  CART  (temporary cart items per customer)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cart (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    product_id      INT NOT NULL,
    platform_id     INT NOT NULL,
    branch_id       INT NOT NULL,
    qty             INT NOT NULL DEFAULT 1,
    added_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cart (customer_id, product_id, platform_id, branch_id),
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)  REFERENCES products(id),
    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    FOREIGN KEY (branch_id)   REFERENCES branches(id)
);

-- ─────────────────────────────────────────────────────────────
--  WISHLIST
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wishlist (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    product_id      INT NOT NULL,
    added_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wish (customer_id, product_id),
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)  REFERENCES products(id)
);

-- ─────────────────────────────────────────────────────────────
--  CUSTOMER ORDERS  (orders placed from shopping site)
--  Links to existing orders table via order_id
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_orders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    order_id        INT NOT NULL,
    address_id      INT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id),
    FOREIGN KEY (order_id)    REFERENCES orders(id),
    FOREIGN KEY (address_id)  REFERENCES customer_addresses(id)
);

-- ─────────────────────────────────────────────────────────────
--  CUSTOMER OTP TOKENS (for forgot password)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_otp_tokens (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT         NOT NULL,
    token       VARCHAR(6)  NOT NULL,
    identifier  VARCHAR(150) NOT NULL,
    expires_at  TIMESTAMP   NOT NULL,
    used        BOOLEAN     DEFAULT FALSE,
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cart_customer ON cart(customer_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_customer ON wishlist(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_orders       ON customer_orders(customer_id);

-- ─────────────────────────────────────────────────────────────
--  TRIGGER: Clear cart after order is placed
-- ─────────────────────────────────────────────────────────────
DELIMITER $$

DROP TRIGGER IF EXISTS trg_clear_cart_on_order$$
CREATE TRIGGER trg_clear_cart_on_order
AFTER INSERT ON customer_orders
FOR EACH ROW
BEGIN
    DELETE FROM cart WHERE customer_id = NEW.customer_id;
    INSERT INTO trigger_logs (event_type, description)
    VALUES ('cart_cleared', CONCAT('Cart cleared for customer_id=', NEW.customer_id, ' after order_id=', NEW.order_id));
END$$

DELIMITER ;

-- ─────────────────────────────────────────────────────────────
--  SEED: Demo customer accounts
-- ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO customer_accounts (name, email, phone, password) VALUES
    ('Priya Mehta',    'priya@email.com',  '9876543210', 'priya123'),
    ('Aakash Joshi',   'aakash@email.com', '9123456780', 'aakash123'),
    ('Kavya Reddy',    'kavya@email.com',  '9012345678', 'kavya123');

-- Seed addresses for demo customer
INSERT IGNORE INTO customer_addresses (customer_id, label, name, phone, line1, city, state, pincode, is_default)
SELECT id, 'Home', name, phone, 'Flat 12B, Sunshine Towers, Andheri West', 'Mumbai', 'Maharashtra', '400058', TRUE
FROM customer_accounts WHERE email = 'priya@email.com';
