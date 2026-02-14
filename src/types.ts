import { z } from 'zod';

// ─── Database Row Types ──────────────────────────────────────────────

export interface UserRow {
  id: number;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface CategoryRow {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  keywords: string[];
  icon: string | null;
  created_at: Date;
}

export interface TransactionRow {
  id: number;
  user_id: number;
  external_id: string | null;
  amount: string; // numeric comes back as string from pg
  currency: string;
  description: string;
  merchant_name: string | null;
  category_id: number | null;
  category_confidence: string | null;
  is_manually_categorized: boolean;
  transaction_date: Date;
  posted_date: Date | null;
  account_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface BudgetRow {
  id: number;
  user_id: number;
  category_id: number;
  amount_limit: string;
  period_type: BudgetPeriodType;
  period_start: Date;
  period_end: Date;
  created_at: Date;
  updated_at: Date;
}

// ─── Enums ───────────────────────────────────────────────────────────

export type BudgetPeriodType = 'monthly' | 'weekly' | 'yearly';

// ─── Zod Schemas (request validation) ────────────────────────────────

export const CreateTransactionSchema = z.object({
  user_id: z.number().int().positive(),
  external_id: z.string().max(255).optional(),
  amount: z.number().finite(),
  currency: z.string().length(3).default('USD'),
  description: z.string().min(1).max(500),
  merchant_name: z.string().max(255).optional(),
  category_id: z.number().int().positive().optional(),
  transaction_date: z.string().datetime({ offset: true }).or(z.string().date()),
  posted_date: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  account_name: z.string().max(255).optional(),
});

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;

export const BulkCreateTransactionsSchema = z.object({
  transactions: z.array(CreateTransactionSchema).min(1).max(1000),
});

export type BulkCreateTransactionsInput = z.infer<typeof BulkCreateTransactionsSchema>;

export const UpdateTransactionSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  merchant_name: z.string().max(255).optional(),
  category_id: z.number().int().positive().optional(),
  amount: z.number().finite().optional(),
});

export type UpdateTransactionInput = z.infer<typeof UpdateTransactionSchema>;

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  parent_id: z.number().int().positive().optional(),
  keywords: z.array(z.string()).default([]),
  icon: z.string().max(50).optional(),
});

export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  keywords: z.array(z.string()).optional(),
  icon: z.string().max(50).optional(),
});

export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;

export const CreateBudgetSchema = z.object({
  user_id: z.number().int().positive(),
  category_id: z.number().int().positive(),
  amount_limit: z.number().positive(),
  period_type: z.enum(['monthly', 'weekly', 'yearly']),
  period_start: z.string().date(),
  period_end: z.string().date(),
});

export type CreateBudgetInput = z.infer<typeof CreateBudgetSchema>;

export const UpdateBudgetSchema = z.object({
  amount_limit: z.number().positive().optional(),
  period_end: z.string().date().optional(),
});

export type UpdateBudgetInput = z.infer<typeof UpdateBudgetSchema>;

// ─── Query Parameter Schemas ─────────────────────────────────────────

export const TransactionQuerySchema = z.object({
  user_id: z.coerce.number().int().positive(),
  category_id: z.coerce.number().int().positive().optional(),
  from_date: z.string().date().optional(),
  to_date: z.string().date().optional(),
  min_amount: z.coerce.number().optional(),
  max_amount: z.coerce.number().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort_by: z.enum(['transaction_date', 'amount', 'created_at']).default('transaction_date'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

export type TransactionQuery = z.infer<typeof TransactionQuerySchema>;

export const AnalyticsQuerySchema = z.object({
  user_id: z.coerce.number().int().positive(),
  from_date: z.string().date().optional(),
  to_date: z.string().date().optional(),
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

// ─── API Response Types ──────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface MonthlySummary {
  month: string;
  total_spent: number;
  transaction_count: number;
  avg_transaction: number;
  top_category: string | null;
}

export interface CategoryBreakdown {
  category_id: number;
  category_name: string;
  category_slug: string;
  total_spent: number;
  transaction_count: number;
  percentage: number;
}

export interface BudgetStatus {
  budget_id: number;
  category_name: string;
  amount_limit: number;
  amount_spent: number;
  remaining: number;
  utilization_pct: number;
  period_type: BudgetPeriodType;
  period_start: string;
  period_end: string;
  is_over_budget: boolean;
}

export interface SpendingTrend {
  month: string;
  category_name: string;
  total_spent: number;
  mom_change_pct: number | null;
}

export interface CategorizationResult {
  category_id: number;
  category_slug: string;
  confidence: number;
  method: 'rule' | 'statistical' | 'default';
}

export interface ApiError {
  status: number;
  message: string;
  details?: unknown;
}
