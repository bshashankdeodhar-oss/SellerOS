USE selleros;
SHOW TABLES;

SELECT stock FROM inventory
WHERE product_id = 1 AND branch_id = 1 AND platform_id = 1;

INSERT INTO orders
(order_ref, product_id, branch_id, platform_id,
 customer_id, seller_id, qty,
 unit_price, total_amount)
VALUES
('ORD-DEMO', 1, 1, 1, 1, 3, 1, 2499, 2499);

SELECT stock FROM inventory
WHERE product_id = 1 AND branch_id = 1 AND platform_id = 1;

START TRANSACTION;

INSERT INTO orders
(order_ref, product_id, branch_id, platform_id,
 customer_id, seller_id, qty,
 unit_price, total_amount)
VALUES
('ORD-TXN', 1, 1, 1, 1, 3, 5, 2499, 12495);

ROLLBACK;

SELECT * FROM orders WHERE order_ref = 'ORD-TXN';

EXPLAIN SELECT * FROM orders WHERE customer_id = 1;
EXPLAIN
SELECT o.order_ref, p.name
FROM orders o
JOIN products p ON o.product_id = p.id;

CREATE USER 'viewer_user'@'localhost' IDENTIFIED BY 'viewer123';
GRANT SELECT ON selleros.* TO 'viewer_user'@'localhost';
FLUSH PRIVILEGES;

