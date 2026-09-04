-- Enable pgcrypto for UUID generation if on older postgres
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS transaction_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_pay_id VARCHAR(255) UNIQUE NOT NULL,
  razorpay_order_id VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  customer_email VARCHAR(255),
  original_amount NUMERIC(10, 2) NOT NULL,
  failure_reason VARCHAR(100) NOT NULL,
  failure_source VARCHAR(50) NOT NULL,
  diagnosed_strategy VARCHAR(100),
  status VARCHAR(40) DEFAULT 'PENDING',
  attempts_count INT DEFAULT 0,
  total_cost_incurred NUMERIC(10, 2) DEFAULT 0.0,
  total_discount_given NUMERIC(10, 2) DEFAULT 0.0,
  recovered_amount NUMERIC(10, 2) DEFAULT 0.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transaction_failures(id) ON DELETE CASCADE,
  step VARCHAR(100) NOT NULL,
  reasoning TEXT NOT NULL,
  cost_incurred NUMERIC(10, 2) DEFAULT 0.0,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_key VARCHAR(255) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tf_pay_id ON transaction_failures(razorpay_pay_id);
CREATE INDEX IF NOT EXISTS idx_tf_status ON transaction_failures(status);
CREATE INDEX IF NOT EXISTS idx_tf_order_id ON transaction_failures(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_audit_tx_id ON audit_logs(transaction_id);
