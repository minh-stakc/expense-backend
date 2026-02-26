import { query } from '../db/connection';
import * as CategoryModel from '../models/category';
import { config } from '../config';
import { CategorizationResult, CategoryRow, TransactionRow } from '../types';

/**
 * Rule-based + statistical transaction categorization engine.
 *
 * Strategy (in priority order):
 * 1. Merchant history lookup — if we've seen this merchant before and users
 *    have manually confirmed its category, trust that.
 * 2. Keyword matching — match transaction description / merchant name against
 *    each category's keyword list. Score by number of keyword hits.
 * 3. Default — assign "other" with low confidence.
 */

interface KeywordCategory {
  id: number;
  slug: string;
  keywords: string[];
}

let cachedCategories: KeywordCategory[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

async function getKeywordCategories(): Promise<KeywordCategory[]> {
  const now = Date.now();
  if (cachedCategories && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCategories;
  }
  cachedCategories = await CategoryModel.findAllWithKeywords();
  cacheTimestamp = now;
  return cachedCategories;
}

/** Clear the category cache (useful after category updates). */
export function invalidateCache(): void {
  cachedCategories = null;
  cacheTimestamp = 0;
}

// ─── Strategy 1: Merchant History (Statistical) ──────────────────────

async function categorizByMerchantHistory(
  merchantName: string | null
): Promise<CategorizationResult | null> {
  if (!merchantName) return null;

  const merchantKey = merchantName.toLowerCase().trim();
  if (!merchantKey) return null;

  try {
    const result = await query<{
      category_id: number;
      category_slug: string;
      confidence: string;
    }>(
      `SELECT category_id, category_slug, confidence
       FROM mv_merchant_categories
       WHERE merchant_key = $1
       ORDER BY confidence DESC
       LIMIT 1`,
      [merchantKey]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const confidence = parseFloat(row.confidence);

    if (confidence < config.categorizer.confidenceThreshold) return null;

    return {
      category_id: row.category_id,
      category_slug: row.category_slug,
      confidence,
      method: 'statistical',
    };
  } catch {
    // Materialized view might not exist yet; fall through
    return null;
  }
}

// ─── Strategy 2: Keyword Matching (Rule-based) ──────────────────────

interface KeywordScore {
  categoryId: number;
  categorySlug: string;
  score: number;
  maxPossible: number;
}

function categorizeByKeywords(
  description: string,
  merchantName: string | null,
  categories: KeywordCategory[]
): CategorizationResult | null {
  const text = `${description} ${merchantName ?? ''}`.toLowerCase();

  const scores: KeywordScore[] = [];

  for (const cat of categories) {
    if (cat.keywords.length === 0) continue;

    let hits = 0;
    for (const keyword of cat.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        hits++;
      }
    }

    if (hits > 0) {
      scores.push({
        categoryId: cat.id,
        categorySlug: cat.slug,
        score: hits,
        maxPossible: cat.keywords.length,
      });
    }
  }

  if (scores.length === 0) return null;

  // Sort by number of hits descending, then by specificity (fewer keywords = more specific)
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.maxPossible - b.maxPossible;
  });

  const best = scores[0];
  // Confidence: ratio of hits to total keywords, boosted if multiple hits
  const baseConfidence = best.score / best.maxPossible;
  const hitBonus = Math.min(best.score * 0.1, 0.3);
  const confidence = Math.min(baseConfidence + hitBonus, 1.0);

  if (confidence < config.categorizer.confidenceThreshold) return null;

  return {
    category_id: best.categoryId,
    category_slug: best.categorySlug,
    confidence: Math.round(confidence * 1000) / 1000,
    method: 'rule',
  };
}

// ─── Strategy 3: Default ─────────────────────────────────────────────

async function getDefaultCategory(): Promise<CategorizationResult> {
  const other = await CategoryModel.findBySlug('other');
  return {
    category_id: other?.id ?? 12,
    category_slug: 'other',
    confidence: 0.1,
    method: 'default',
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Categorize a single transaction.
 * Returns the best category match with confidence score and method used.
 */
export async function categorize(
  description: string,
  merchantName: string | null
): Promise<CategorizationResult> {
  // 1. Try merchant history (statistical)
  const merchantResult = await categorizByMerchantHistory(merchantName);
  if (merchantResult) return merchantResult;

  // 2. Try keyword matching (rule-based)
  const categories = await getKeywordCategories();
  const keywordResult = categorizeByKeywords(description, merchantName, categories);
  if (keywordResult) return keywordResult;

  // 3. Default
  return getDefaultCategory();
}

/**
 * Categorize a batch of transactions.
 * Returns a map of transaction ID to categorization result.
 */
export async function categorizeBatch(
  transactions: TransactionRow[]
): Promise<Map<number, CategorizationResult>> {
  const categories = await getKeywordCategories();
  const results = new Map<number, CategorizationResult>();

  for (const txn of transactions) {
    // 1. Merchant history
    const merchantResult = await categorizByMerchantHistory(txn.merchant_name);
    if (merchantResult) {
      results.set(txn.id, merchantResult);
      continue;
    }

    // 2. Keywords
    const keywordResult = categorizeByKeywords(
      txn.description,
      txn.merchant_name,
      categories
    );
    if (keywordResult) {
      results.set(txn.id, keywordResult);
      continue;
    }

    // 3. Default
    results.set(txn.id, await getDefaultCategory());
  }

  return results;
}

/**
 * Detect recurring transactions (subscriptions) for a user.
 * Looks for same merchant + similar amount occurring monthly.
 */
export async function detectSubscriptions(
  userId: number
): Promise<Array<{ merchant_name: string; avg_amount: number; frequency: number; category_id: number | null }>> {
  const result = await query<{
    merchant_name: string;
    avg_amount: string;
    frequency: string;
    category_id: number | null;
  }>(
    `WITH monthly_merchants AS (
       SELECT
         merchant_name,
         date_trunc('month', transaction_date) AS month,
         AVG(ABS(amount)) AS avg_amount,
         COUNT(*) AS txn_count,
         category_id
       FROM transactions
       WHERE user_id = $1
         AND merchant_name IS NOT NULL
         AND merchant_name != ''
       GROUP BY merchant_name, date_trunc('month', transaction_date), category_id
     )
     SELECT
       merchant_name,
       AVG(avg_amount)::NUMERIC(12,2) AS avg_amount,
       COUNT(DISTINCT month)::INT     AS frequency,
       MODE() WITHIN GROUP (ORDER BY category_id) AS category_id
     FROM monthly_merchants
     GROUP BY merchant_name
     HAVING COUNT(DISTINCT month) >= 3
       AND STDDEV(avg_amount) / NULLIF(AVG(avg_amount), 0) < 0.15
     ORDER BY frequency DESC`,
    [userId]
  );

  return result.rows.map((r) => ({
    merchant_name: r.merchant_name,
    avg_amount: parseFloat(r.avg_amount),
    frequency: parseInt(r.frequency, 10),
    category_id: r.category_id,
  }));
}
