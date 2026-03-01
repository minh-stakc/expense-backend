import { query } from '../db/connection';
import {
  MonthlySummary,
  CategoryBreakdown,
  SpendingTrend,
  AnalyticsQuery,
} from '../types';

/**
 * Get monthly spending summaries for a user.
 * Uses the materialized view for fast lookups; falls back to live query.
 */
export async function getMonthlySummaries(
  params: AnalyticsQuery
): Promise<MonthlySummary[]> {
  const conditions: string[] = ['user_id = $1'];
  const qParams: unknown[] = [params.user_id];
  let idx = 2;

  if (params.from_date) {
    conditions.push(`month >= $${idx++}`);
    qParams.push(params.from_date);
  }
  if (params.to_date) {
    conditions.push(`month <= $${idx++}`);
    qParams.push(params.to_date);
  }

  const where = conditions.join(' AND ');

  try {
    // Try materialized view first (fast path)
    const result = await query<{
      month: Date;
      total_spent: string;
      transaction_count: string;
      avg_transaction: string;
    }>(
      `SELECT month, total_spent, transaction_count, avg_transaction
       FROM mv_monthly_totals
       WHERE ${where}
       ORDER BY month DESC`,
      qParams
    );

    const summaries: MonthlySummary[] = [];

    for (const row of result.rows) {
      // Get top category for this month
      const topCat = await query<{ category_name: string }>(
        `SELECT category_name
         FROM mv_monthly_category_spending
         WHERE user_id = $1 AND month = $2
         ORDER BY total_spent DESC
         LIMIT 1`,
        [params.user_id, row.month]
      );

      summaries.push({
        month: row.month.toISOString().substring(0, 7),
        total_spent: parseFloat(row.total_spent),
        transaction_count: parseInt(row.transaction_count, 10),
        avg_transaction: parseFloat(parseFloat(row.avg_transaction).toFixed(2)),
        top_category: topCat.rows[0]?.category_name ?? null,
      });
    }

    return summaries;
  } catch {
    // Materialized view not available; use live query
    return getMonthlySummariesLive(params);
  }
}

async function getMonthlySummariesLive(
  params: AnalyticsQuery
): Promise<MonthlySummary[]> {
  const conditions: string[] = ['t.user_id = $1'];
  const qParams: unknown[] = [params.user_id];
  let idx = 2;

  if (params.from_date) {
    conditions.push(`t.transaction_date >= $${idx++}`);
    qParams.push(params.from_date);
  }
  if (params.to_date) {
    conditions.push(`t.transaction_date <= $${idx++}`);
    qParams.push(params.to_date);
  }

  const where = conditions.join(' AND ');

  const result = await query<{
    month: Date;
    total_spent: string;
    transaction_count: string;
    avg_transaction: string;
    top_category: string | null;
  }>(
    `SELECT
       date_trunc('month', t.transaction_date)::DATE AS month,
       SUM(ABS(t.amount))::NUMERIC(12,2)             AS total_spent,
       COUNT(*)                                       AS transaction_count,
       AVG(ABS(t.amount))::NUMERIC(12,2)              AS avg_transaction,
       (
         SELECT c.name
         FROM transactions t2
         JOIN categories c ON c.id = t2.category_id
         WHERE t2.user_id = t.user_id
           AND date_trunc('month', t2.transaction_date) = date_trunc('month', t.transaction_date)
           AND c.slug NOT IN ('income', 'transfer')
         GROUP BY c.name
         ORDER BY SUM(ABS(t2.amount)) DESC
         LIMIT 1
       ) AS top_category
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${where}
       AND (c.slug IS NULL OR c.slug NOT IN ('income', 'transfer'))
     GROUP BY t.user_id, date_trunc('month', t.transaction_date)::DATE
     ORDER BY month DESC`,
    qParams
  );

  return result.rows.map((row) => ({
    month: row.month.toISOString().substring(0, 7),
    total_spent: parseFloat(row.total_spent),
    transaction_count: parseInt(row.transaction_count, 10),
    avg_transaction: parseFloat(row.avg_transaction),
    top_category: row.top_category,
  }));
}

/**
 * Get spending breakdown by category for a given period.
 */
export async function getCategoryBreakdown(
  params: AnalyticsQuery
): Promise<CategoryBreakdown[]> {
  const conditions: string[] = ['t.user_id = $1'];
  const qParams: unknown[] = [params.user_id];
  let idx = 2;

  if (params.from_date) {
    conditions.push(`t.transaction_date >= $${idx++}`);
    qParams.push(params.from_date);
  }
  if (params.to_date) {
    conditions.push(`t.transaction_date <= $${idx++}`);
    qParams.push(params.to_date);
  }

  const where = conditions.join(' AND ');

  const result = await query<{
    category_id: number;
    category_name: string;
    category_slug: string;
    total_spent: string;
    transaction_count: string;
    percentage: string;
  }>(
    `WITH totals AS (
       SELECT SUM(ABS(t.amount)) AS grand_total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${where}
         AND (c.slug IS NULL OR c.slug NOT IN ('income', 'transfer'))
     )
     SELECT
       COALESCE(t.category_id, 0)                              AS category_id,
       COALESCE(c.name, 'Uncategorized')                       AS category_name,
       COALESCE(c.slug, 'uncategorized')                       AS category_slug,
       SUM(ABS(t.amount))::NUMERIC(12,2)                       AS total_spent,
       COUNT(*)                                                 AS transaction_count,
       ROUND(SUM(ABS(t.amount)) / NULLIF(totals.grand_total, 0) * 100, 1) AS percentage
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     CROSS JOIN totals
     WHERE ${where}
       AND (c.slug IS NULL OR c.slug NOT IN ('income', 'transfer'))
     GROUP BY t.category_id, c.name, c.slug, totals.grand_total
     ORDER BY total_spent DESC`,
    qParams
  );

  return result.rows.map((row) => ({
    category_id: row.category_id,
    category_name: row.category_name,
    category_slug: row.category_slug,
    total_spent: parseFloat(row.total_spent),
    transaction_count: parseInt(row.transaction_count, 10),
    percentage: parseFloat(row.percentage),
  }));
}

/**
 * Get month-over-month spending trends by category.
 * Includes the percentage change from the previous month.
 */
export async function getSpendingTrends(
  params: AnalyticsQuery & { months?: number }
): Promise<SpendingTrend[]> {
  const months = params.months ?? 6;

  const result = await query<{
    month: Date;
    category_name: string;
    total_spent: string;
    prev_month_spent: string | null;
  }>(
    `WITH monthly AS (
       SELECT
         date_trunc('month', t.transaction_date)::DATE AS month,
         c.name                                        AS category_name,
         SUM(ABS(t.amount))::NUMERIC(12,2)             AS total_spent
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = $1
         AND c.slug NOT IN ('income', 'transfer')
         AND t.transaction_date >= (CURRENT_DATE - ($2::INT || ' months')::INTERVAL)
       GROUP BY date_trunc('month', t.transaction_date)::DATE, c.name
     )
     SELECT
       m.month,
       m.category_name,
       m.total_spent,
       LAG(m.total_spent) OVER (
         PARTITION BY m.category_name ORDER BY m.month
       ) AS prev_month_spent
     FROM monthly m
     ORDER BY m.month DESC, m.total_spent DESC`,
    [params.user_id, months]
  );

  return result.rows.map((row) => {
    const current = parseFloat(row.total_spent);
    const prev = row.prev_month_spent ? parseFloat(row.prev_month_spent) : null;
    const momChange =
      prev !== null && prev > 0
        ? Math.round(((current - prev) / prev) * 1000) / 10
        : null;

    return {
      month: row.month.toISOString().substring(0, 7),
      category_name: row.category_name,
      total_spent: current,
      mom_change_pct: momChange,
    };
  });
}

/**
 * Refresh all analytics materialized views.
 */
export async function refreshAnalyticViews(): Promise<void> {
  try {
    await query('SELECT refresh_analytics_views()');
  } catch (err) {
    console.warn('Failed to refresh analytics views (may not exist yet):', err);
  }
}

/**
 * Get daily spending for a user over a date range (for charting).
 */
export async function getDailySpending(
  userId: number,
  fromDate: string,
  toDate: string
): Promise<Array<{ date: string; total_spent: number }>> {
  const result = await query<{ date: Date; total_spent: string }>(
    `SELECT
       t.transaction_date::DATE AS date,
       SUM(ABS(t.amount))::NUMERIC(12,2) AS total_spent
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = $1
       AND t.transaction_date >= $2
       AND t.transaction_date <= $3
       AND (c.slug IS NULL OR c.slug NOT IN ('income', 'transfer'))
     GROUP BY t.transaction_date::DATE
     ORDER BY date ASC`,
    [userId, fromDate, toDate]
  );

  return result.rows.map((r) => ({
    date: r.date.toISOString().substring(0, 10),
    total_spent: parseFloat(r.total_spent),
  }));
}
