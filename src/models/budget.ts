import { query } from '../db/connection';
import {
  BudgetRow,
  BudgetStatus,
  CreateBudgetInput,
  UpdateBudgetInput,
} from '../types';

export async function findById(id: number): Promise<BudgetRow | null> {
  const result = await query<BudgetRow>(
    `SELECT * FROM budgets WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function findByUser(userId: number): Promise<BudgetRow[]> {
  const result = await query<BudgetRow>(
    `SELECT * FROM budgets
     WHERE user_id = $1
     ORDER BY period_start DESC, category_id`,
    [userId]
  );
  return result.rows;
}

export async function create(input: CreateBudgetInput): Promise<BudgetRow> {
  const result = await query<BudgetRow>(
    `INSERT INTO budgets
       (user_id, category_id, amount_limit, period_type, period_start, period_end)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.user_id,
      input.category_id,
      input.amount_limit,
      input.period_type,
      input.period_start,
      input.period_end,
    ]
  );
  return result.rows[0];
}

export async function update(
  id: number,
  input: UpdateBudgetInput
): Promise<BudgetRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.amount_limit !== undefined) {
    sets.push(`amount_limit = $${idx++}`);
    params.push(input.amount_limit);
  }
  if (input.period_end !== undefined) {
    sets.push(`period_end = $${idx++}`);
    params.push(input.period_end);
  }

  if (sets.length === 0) return findById(id);

  params.push(id);
  const result = await query<BudgetRow>(
    `UPDATE budgets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0] ?? null;
}

export async function remove(id: number): Promise<boolean> {
  const result = await query('DELETE FROM budgets WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get the status of all active budgets for a user, including how much
 * has been spent against each budget in its period.
 * This uses a lateral join for efficient per-budget aggregation.
 */
export async function getBudgetStatuses(userId: number): Promise<BudgetStatus[]> {
  const result = await query<BudgetStatus>(
    `SELECT
       b.id                                  AS budget_id,
       c.name                                AS category_name,
       b.amount_limit::FLOAT                 AS amount_limit,
       COALESCE(s.total_spent, 0)::FLOAT     AS amount_spent,
       (b.amount_limit - COALESCE(s.total_spent, 0))::FLOAT AS remaining,
       ROUND(COALESCE(s.total_spent, 0) / b.amount_limit * 100, 1)::FLOAT AS utilization_pct,
       b.period_type,
       b.period_start::TEXT                  AS period_start,
       b.period_end::TEXT                    AS period_end,
       COALESCE(s.total_spent, 0) > b.amount_limit AS is_over_budget
     FROM budgets b
     JOIN categories c ON c.id = b.category_id
     LEFT JOIN LATERAL (
       SELECT SUM(ABS(t.amount)) AS total_spent
       FROM transactions t
       WHERE t.user_id = b.user_id
         AND t.category_id = b.category_id
         AND t.transaction_date >= b.period_start
         AND t.transaction_date <= b.period_end
     ) s ON TRUE
     WHERE b.user_id = $1
       AND b.period_end >= CURRENT_DATE
     ORDER BY utilization_pct DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Get budget status for a specific category in the current period.
 */
export async function getBudgetForCategory(
  userId: number,
  categoryId: number,
  date: string
): Promise<BudgetStatus | null> {
  const result = await query<BudgetStatus>(
    `SELECT
       b.id                                  AS budget_id,
       c.name                                AS category_name,
       b.amount_limit::FLOAT                 AS amount_limit,
       COALESCE(s.total_spent, 0)::FLOAT     AS amount_spent,
       (b.amount_limit - COALESCE(s.total_spent, 0))::FLOAT AS remaining,
       ROUND(COALESCE(s.total_spent, 0) / b.amount_limit * 100, 1)::FLOAT AS utilization_pct,
       b.period_type,
       b.period_start::TEXT                  AS period_start,
       b.period_end::TEXT                    AS period_end,
       COALESCE(s.total_spent, 0) > b.amount_limit AS is_over_budget
     FROM budgets b
     JOIN categories c ON c.id = b.category_id
     LEFT JOIN LATERAL (
       SELECT SUM(ABS(t.amount)) AS total_spent
       FROM transactions t
       WHERE t.user_id = b.user_id
         AND t.category_id = b.category_id
         AND t.transaction_date >= b.period_start
         AND t.transaction_date <= b.period_end
     ) s ON TRUE
     WHERE b.user_id = $1
       AND b.category_id = $2
       AND b.period_start <= $3::DATE
       AND b.period_end >= $3::DATE
     LIMIT 1`,
    [userId, categoryId, date]
  );
  return result.rows[0] ?? null;
}
