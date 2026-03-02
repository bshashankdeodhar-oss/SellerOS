USE selleros;

DELIMITER $$

DROP TRIGGER IF EXISTS trg_check_stock_before_order$$
CREATE TRIGGER trg_check_stock_before_order
BEFORE INSERT ON orders
FOR EACH ROW
BEGIN
    DECLARE available_stock INT;

    SELECT stock INTO available_stock
    FROM inventory
    WHERE product_id = NEW.product_id
      AND branch_id = NEW.branch_id
      AND platform_id = NEW.platform_id;

    IF available_stock < NEW.qty THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Insufficient stock for this order.';
    END IF;
END$$

DELIMITER ;

SHOW TRIGGERS;