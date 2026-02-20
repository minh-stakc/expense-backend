import { PoolClient } from 'pg';
import { query, getPool } from '../db/connection';
import {
  TransactionRow,
  CreateTransactionInput,
  UpdateTransactionInput,
  TransactionQuery,
  PaginatedResponse,
} from '../types';

export async function findById(id: number): Promise<TransactionRow | null> {
  const result = await query<TransactionRow>(
    `SELECT * FROM transactions WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function findPaginated(
  q: TransactionQuery
): Promise<PaginatedResponse<TransactionRow>> {
  const conditions: string[] = ['t.user_id = $1'];
  const params: unknown[] = [q.user_id];
  let idx = 2;

  if (q.category_id !== undefined) {
    conditions.push(`t.category_id = $${idx++}`);
    params.push(q.category_id);
  }
  if (q.from_date) {
    conditions.push(`t.transaction_date >= $${idx++}`);
    params.push(q.from_date);
  }
  if (q.to_date) {
    conditions.push(`t.transaction_date <= $${idx++}`);
    params.push(q.to_date);
  }
  if (q.min_amount !== undefined) {
    conditions.push(`ABS(t.amount) >= $${idx++}`);
    params.push(q.min_amount);
  }
  if (q.max_amount !== undefined) {
    conditions.push(`ABS(t.amount) <= $${idx++}`);
    params.push(q.max_amount);
  }
  if (q.search) {
    conditions.push(
      `(lower(t.description) LIKE $${idx} OR lower(t.merchant_name) LIKE $${idx})`
    );
    params.push(`%${q.search.toLowerCase()}%`);
    idx++;
  }

  const whereClause = conditions.join(' AND ');
  const offset = (q.page - 1) * q.limit;

  // Allowed sort columns are validated by Zod schema
  const orderBy = `t.${q.sort_by} ${q.sort_order}`;

  const [dataResult, countResult] = await Promise.all([
    query<TransactionRow>(
      `SELECT t.*
       FROM transactions t
       WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, q.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM transactions t WHERE ${whereClause}`,
      params
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  return {
    data: dataResult.rows,
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      total_pages: Math.ceil(total / q.limit),
    },
  };
}

export async function create(input: CreateTransactionInput): Promise<TransactionRow> {
  const result = await query<TransactionRow>(
    `INSERT INTO transactions
       (user_id, external_id, amount, currency, description, merchant_name,
        category_id, transaction_date, posted_date, account_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.user_id,
      input.external_id ?? null,
      input.amount,
      input.currency,
      input.description,
      input.merchant_name ?? null,
      input.category_id ?? null,
      input.transaction_date,
      input.posted_date ?? null,
      input.account_name ?? null,
    ]
  );
  return result.rows[0];
}

/**
 * Bulk insert transactions using a single multi-row INSERT.
 * Returns all inserted rows.
 */
export async function bulkCreate(
  inputs: CreateTransactionInput[],
  client?: PoolClient
): Promise<TransactionRow[]> {
  if (inputs.length === 0) return [];

  const valuePlaceholders: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const input of inputs) {
    valuePlaceholders.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
    );
    params.push(
      input.user_id,
      input.external_id ?? null,
      input.amount,
      input.currency,
      input.description,
      input.merchant_name ?? null,
      input.category_id ?? null,
      input.transaction_date,
      input.posted_date ?? null,
      input.account_name ?? null
    );
  }

  const sql = `
    INSERT INTO transactions
      (user_id, external_id, amount, currency, description, merchant_name,
       category_id, transaction_date, posted_date, account_name)
    VALUES ${valuePlaceholders.join(', ')}
    ON CONFLICT (user_id, external_id) DO NOTHING
    RETURNING *
  `;

  const executor = client ?? getPool();
  const result = await executor.query<TransactionRow>(sql, params);
  return result.rows;
}

export async function update(
  id: number,
  input: UpdateTransactionInput
): Promise<TransactionRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(input.description);
  }
  if (input.merchant_name !== undefined) {
    sets.push(`merchant_name = $${idx++}`);
    params.push(input.merchant_name);
  }
  if (input.category_id !== undefined) {
    sets.push(`category_id = $${idx++}`);
    params.push(input.category_id);
    sets.push(`is_manually_categorized = TRUE`);
  }
  if (input.amount !== undefined) {
    sets.push(`amount = $${idx++}`);
    params.push(input.amount);
  }

  if (sets.length === 0) return findById(id);

  params.push(id);
  const result = await query<TransactionRow>(
    `UPDATE transactions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0] ?? null;
}

export async function remove(id: number): Promise<boolean> {
  const result = await query('DELETE FROM transactions WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Update the category assignment on a transaction (used by auto-categorizer).
 */
export async function setCategory(
  id: number,
  categoryId: number,
  confidence: number,
  client?: PoolClient
): Promise<void> {
  const sql = `
    UPDATE transactions
    SET category_id = $1, category_confidence = $2, is_manually_categorized = FALSE
    WHERE id = $3 AND is_manually_categorized = FALSE
  `;
  const executor = client ?? getPool();
  await executor.query(sql, [categoryId, confidence, id]);
}

/**
 * Find uncategorized transactions for a user (for batch categorization).
 */
export async function findUncategorized(
  userId: number,
  limit = 500
): Promise<TransactionRow[]> {
  const result = await query<TransactionRow>(
    `SELECT *
     FROM transactions
     WHERE user_id = $1 AND category_id IS NULL
     ORDER BY created_at ASC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}
