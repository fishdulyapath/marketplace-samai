-- Marketplace request lifecycle. ERP tables retain their existing schema.
CREATE TABLE IF NOT EXISTS marketplace_pending_order (
  doc_no VARCHAR(30) PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL UNIQUE,
  cust_code VARCHAR(25) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','cancelled','rejected')),
  doc_source VARCHAR(6) NOT NULL CHECK (doc_source IN ('client','server')),
  reserved_qt_no VARCHAR(30) UNIQUE,
  qt_doc_no VARCHAR(30),
  qt_doc_nos JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acted_at TIMESTAMPTZ,
  acted_by VARCHAR(50),
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS marketplace_pending_order_queue_idx
  ON marketplace_pending_order (status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_pending_order_customer_idx
  ON marketplace_pending_order (cust_code, created_at DESC);
