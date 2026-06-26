-- ==========================================
-- POS ระบบจัดการร้านค้า — Supabase Schema
-- ==========================================

-- ตั้งค่าร้าน
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO settings (key, value) VALUES
  ('shop_name',     'ร้านของฉัน'),
  ('shop_address',  ''),
  ('shop_tax_id',   ''),
  ('shop_phone',    ''),
  ('vat_rate',      '0'),
  ('ot_rate',       '75'),
  ('receipt_footer','ขอบคุณที่ใช้บริการ'),
  ('currency',      'THB')
ON CONFLICT (key) DO NOTHING;

-- หมวดหมู่สินค้า
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- สินค้า
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  barcode     TEXT UNIQUE,
  name        TEXT NOT NULL,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  unit        TEXT DEFAULT 'ชิ้น',
  cost        NUMERIC(14,2) DEFAULT 0,
  price       NUMERIC(14,2) NOT NULL DEFAULT 0,
  stock       NUMERIC(14,3) DEFAULT 0,
  min_stock   NUMERIC(14,3) DEFAULT 5,
  active      BOOLEAN DEFAULT TRUE,
  image_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ลูกค้า
CREATE TABLE IF NOT EXISTS customers (
  id           SERIAL PRIMARY KEY,
  code         TEXT UNIQUE,
  name         TEXT NOT NULL,
  phone        TEXT,
  address      TEXT,
  tax_id       TEXT,
  credit_limit NUMERIC(14,2) DEFAULT 0,
  balance      NUMERIC(14,2) DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ซัพพลายเออร์
CREATE TABLE IF NOT EXISTS suppliers (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE,
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  tax_id     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- พนักงาน
CREATE TABLE IF NOT EXISTS employees (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE,
  name            TEXT NOT NULL,
  position        TEXT,
  salary          NUMERIC(14,2) DEFAULT 0,
  ot_rate         NUMERIC(10,2),
  social_security NUMERIC(10,2) DEFAULT 750,
  bank_account    TEXT,
  bank_name       TEXT,
  start_date      DATE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- บิลขาย (header)
CREATE TABLE IF NOT EXISTS sales (
  id             SERIAL PRIMARY KEY,
  receipt_no     TEXT UNIQUE NOT NULL,
  customer_id    INT REFERENCES customers(id) ON DELETE SET NULL,
  employee_id    INT REFERENCES employees(id) ON DELETE SET NULL,
  subtotal       NUMERIC(14,2) DEFAULT 0,
  discount       NUMERIC(14,2) DEFAULT 0,
  vat            NUMERIC(14,2) DEFAULT 0,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  payment_amount NUMERIC(14,2) DEFAULT 0,
  change_amount  NUMERIC(14,2) DEFAULT 0,
  note           TEXT,
  status         TEXT DEFAULT 'completed',  -- completed, voided, credit
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- รายการในบิลขาย
CREATE TABLE IF NOT EXISTS sale_items (
  id           SERIAL PRIMARY KEY,
  sale_id      INT REFERENCES sales(id) ON DELETE CASCADE,
  product_id   INT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  barcode      TEXT,
  unit         TEXT,
  qty          NUMERIC(14,3) NOT NULL DEFAULT 1,
  price        NUMERIC(14,2) NOT NULL,
  cost         NUMERIC(14,2) DEFAULT 0,
  discount     NUMERIC(14,2) DEFAULT 0,
  subtotal     NUMERIC(14,2) NOT NULL
);

-- ใบสั่งซื้อ PO (header)
CREATE TABLE IF NOT EXISTS purchase_orders (
  id          SERIAL PRIMARY KEY,
  po_no       TEXT UNIQUE NOT NULL,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  status      TEXT DEFAULT 'draft',   -- draft, ordered, received, cancelled
  subtotal    NUMERIC(14,2) DEFAULT 0,
  tax         NUMERIC(14,2) DEFAULT 0,
  total       NUMERIC(14,2) DEFAULT 0,
  note        TEXT,
  ordered_at  TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- รายการ PO
CREATE TABLE IF NOT EXISTS po_items (
  id            SERIAL PRIMARY KEY,
  po_id         INT REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id    INT REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,
  barcode       TEXT,
  unit          TEXT,
  qty           NUMERIC(14,3) NOT NULL DEFAULT 1,
  received_qty  NUMERIC(14,3) DEFAULT 0,
  cost          NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotal      NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- ประวัติสต็อก
CREATE TABLE IF NOT EXISTS stock_history (
  id             SERIAL PRIMARY KEY,
  product_id     INT REFERENCES products(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,   -- sale, po_receive, adjust_in, adjust_out, void
  reference_id   INT,
  reference_type TEXT,
  qty_before     NUMERIC(14,3),
  qty_change     NUMERIC(14,3),
  qty_after      NUMERIC(14,3),
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- สลิปเงินเดือน
CREATE TABLE IF NOT EXISTS payslips (
  id             SERIAL PRIMARY KEY,
  employee_id    INT REFERENCES employees(id) ON DELETE CASCADE,
  period_year    INT NOT NULL,
  period_month   INT NOT NULL,
  salary         NUMERIC(14,2) DEFAULT 0,
  ot_hours       NUMERIC(8,2)  DEFAULT 0,
  ot_rate        NUMERIC(10,2) DEFAULT 0,
  ot_amount      NUMERIC(14,2) DEFAULT 0,
  bonus          NUMERIC(14,2) DEFAULT 0,
  allowance      NUMERIC(14,2) DEFAULT 0,
  absent_days    NUMERIC(6,1)  DEFAULT 0,
  absent_deduct  NUMERIC(14,2) DEFAULT 0,
  social_security NUMERIC(14,2) DEFAULT 0,
  other_deduct   NUMERIC(14,2) DEFAULT 0,
  net_pay        NUMERIC(14,2) NOT NULL DEFAULT 0,
  note           TEXT,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ค่าใช้จ่าย (สำหรับสรุปกำไร/ขาดทุน)
CREATE TABLE IF NOT EXISTS expenses (
  id           SERIAL PRIMARY KEY,
  category     TEXT,
  description  TEXT NOT NULL,
  amount       NUMERIC(14,2) NOT NULL,
  note         TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_barcode   ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_active     ON products(active);
CREATE INDEX IF NOT EXISTS idx_sales_created       ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status        ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale     ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product  ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po         ON po_items(po_id);
CREATE INDEX IF NOT EXISTS idx_stock_history_prod  ON stock_history(product_id);
CREATE INDEX IF NOT EXISTS idx_payslips_emp        ON payslips(employee_id, period_year, period_month);

-- ============================================================
-- บันทึกการเปิดลิ้นชักด้วยตนเอง
-- ============================================================
CREATE TABLE IF NOT EXISTS drawer_logs (
  id            SERIAL PRIMARY KEY,
  opened_at     TIMESTAMPTZ DEFAULT NOW(),
  employee_id   INT REFERENCES employees(id) ON DELETE SET NULL,
  employee_name TEXT,
  amount        NUMERIC(12,2),
  note          TEXT
);

-- ============================================================
-- RPC: adjust stock atomically
-- ============================================================
CREATE OR REPLACE FUNCTION adjust_stock(p_product_id INT, p_qty_change NUMERIC, p_type TEXT, p_ref_id INT DEFAULT NULL, p_note TEXT DEFAULT '')
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_before NUMERIC;
  v_after  NUMERIC;
BEGIN
  SELECT stock INTO v_before FROM products WHERE id = p_product_id FOR UPDATE;
  v_after := v_before + p_qty_change;
  UPDATE products SET stock = v_after, updated_at = NOW() WHERE id = p_product_id;
  INSERT INTO stock_history(product_id, type, reference_id, qty_before, qty_change, qty_after, note)
  VALUES (p_product_id, p_type, p_ref_id, v_before, p_qty_change, v_after, p_note);
END;
$$;
