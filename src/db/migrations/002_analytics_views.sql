-- 002_analytics_views.sql
-- Materialized views for fast analytics queries

BEGIN;

-- ─── Monthly spending by category (per user) ────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_category_spending AS
SELECT
    t.user_id,
    date_trunc('month', t.transaction_date)::DATE AS month,
    t.category_id,
    c.name                       AS category_name,
    c.slug                       AS category_slug,
    COUNT(*)                     AS transaction_count,
    SUM(ABS(t.amount))           AS total_spent,
    AVG(ABS(t.amount))           AS avg_transaction,
    MIN(ABS(t.amount))           AS min_transaction,
    MAX(ABS(t.amount))           AS max_transaction
FROM transactions t
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.amount < 0 OR (t.category_id IS NOT NULL AND c.slug != 'income' AND c.slug != 'transfer')
GROUP BY t.user_id, date_trunc('month', t.transaction_date)::DATE, t.category_id, c.name, c.slug;

CREATE UNIQUE INDEX idx_mv_mcs_user_month_cat
    ON mv_monthly_category_spending (user_id, month, category_id);
CREATE INDEX idx_mv_mcs_user_month
    ON mv_monthly_category_spending (user_id, month DESC);

-- ─── Monthly spending totals (per user) ──────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_totals AS
SELECT
    t.user_id,
    date_trunc('month', t.transaction_date)::DATE AS month,
    COUNT(*)                     AS transaction_count,
    SUM(ABS(t.amount))           AS total_spent,
    AVG(ABS(t.amount))           AS avg_transaction
FROM transactions t
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.amount < 0 OR (c.slug IS NULL OR (c.slug != 'income' AND c.slug != 'transfer'))
GROUP BY t.user_id, date_trunc('month', t.transaction_date)::DATE;

CREATE UNIQUE INDEX idx_mv_mt_user_month
    ON mv_monthly_totals (user_id, month DESC);

-- ─── Merchant frequency (for statistical categorization) ─────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_merchant_categories AS
SELECT
    lower(trim(t.merchant_name)) AS merchant_key,
    t.category_id,
    c.slug                       AS category_slug,
    COUNT(*)                     AS occurrence_count,
    COUNT(*) * 1.0 / SUM(COUNT(*)) OVER (PARTITION BY lower(trim(t.merchant_name))) AS confidence
FROM transactions t
JOIN categories c ON c.id = t.category_id
WHERE t.merchant_name IS NOT NULL
  AND t.merchant_name != ''
  AND t.is_manually_categorized = TRUE
GROUP BY lower(trim(t.merchant_name)), t.category_id, c.slug;

CREATE UNIQUE INDEX idx_mv_mc_merchant_cat
    ON mv_merchant_categories (merchant_key, category_id);
CREATE INDEX idx_mv_mc_merchant_conf
    ON mv_merchant_categories (merchant_key, confidence DESC);

-- ─── Refresh function (call periodically or after bulk inserts) ──────

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_category_spending;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_totals;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_merchant_categories;
END;
$$ LANGUAGE plpgsql;

COMMIT;
