import { Router, Request, Response } from 'express';
import * as TransactionModel from '../models/transaction';
import * as Categorizer from '../services/categorizer';
import { withTransaction } from '../db/connection';
import { validate } from '../middleware/validation';
import { asyncHandler, notFound } from '../middleware/errorHandler';
import {
  CreateTransactionSchema,
  BulkCreateTransactionsSchema,
  UpdateTransactionSchema,
  TransactionQuerySchema,
} from '../types';

const router = Router();

// ─── GET /transactions — List with filtering & pagination ────────────

router.get(
  '/',
  validate(TransactionQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await TransactionModel.findPaginated(req.query as any);
    res.json(result);
  })
);

// ─── GET /transactions/:id — Single transaction ─────────────────────

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Transaction not found');

    const txn = await TransactionModel.findById(id);
    if (!txn) throw notFound('Transaction not found');

    res.json({ data: txn });
  })
);

// ─── POST /transactions — Create single transaction ──────────────────

router.post(
  '/',
  validate(CreateTransactionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    let input = req.body;

    // Auto-categorize if no category provided
    if (!input.category_id) {
      const result = await Categorizer.categorize(
        input.description,
        input.merchant_name ?? null
      );
      input = {
        ...input,
        category_id: result.category_id,
      };
    }

    const txn = await TransactionModel.create(input);

    // If auto-categorized, set confidence
    if (!req.body.category_id && txn.id) {
      const catResult = await Categorizer.categorize(
        input.description,
        input.merchant_name ?? null
      );
      await TransactionModel.setCategory(txn.id, catResult.category_id, catResult.confidence);
    }

    res.status(201).json({ data: txn });
  })
);

// ─── POST /transactions/bulk — Bulk ingest transactions ──────────────

router.post(
  '/bulk',
  validate(BulkCreateTransactionsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { transactions } = req.body;

    const result = await withTransaction(async (client) => {
      // Insert all transactions
      const inserted = await TransactionModel.bulkCreate(transactions, client);

      // Auto-categorize uncategorized ones
      const uncategorized = inserted.filter((t) => !t.category_id);
      if (uncategorized.length > 0) {
        const catResults = await Categorizer.categorizeBatch(uncategorized);
        for (const [txnId, catResult] of catResults) {
          await TransactionModel.setCategory(
            txnId,
            catResult.category_id,
            catResult.confidence,
            client
          );
        }
      }

      return inserted;
    });

    res.status(201).json({
      data: result,
      meta: {
        submitted: transactions.length,
        inserted: result.length,
        skipped_duplicates: transactions.length - result.length,
      },
    });
  })
);

// ─── PATCH /transactions/:id — Update transaction ────────────────────

router.patch(
  '/:id',
  validate(UpdateTransactionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Transaction not found');

    const txn = await TransactionModel.update(id, req.body);
    if (!txn) throw notFound('Transaction not found');

    res.json({ data: txn });
  })
);

// ─── DELETE /transactions/:id ────────────────────────────────────────

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Transaction not found');

    const deleted = await TransactionModel.remove(id);
    if (!deleted) throw notFound('Transaction not found');

    res.status(204).send();
  })
);

// ─── POST /transactions/:id/categorize — Re-categorize a transaction ─

router.post(
  '/:id/categorize',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Transaction not found');

    const txn = await TransactionModel.findById(id);
    if (!txn) throw notFound('Transaction not found');

    const result = await Categorizer.categorize(
      txn.description,
      txn.merchant_name
    );

    await TransactionModel.setCategory(id, result.category_id, result.confidence);

    res.json({
      data: {
        transaction_id: id,
        ...result,
      },
    });
  })
);

// ─── POST /transactions/categorize-uncategorized — Batch categorize ──

router.post(
  '/categorize-uncategorized',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseInt(String(req.query.user_id), 10);
    if (isNaN(userId)) {
      res.status(400).json({ status: 400, message: 'user_id query param required' });
      return;
    }

    const uncategorized = await TransactionModel.findUncategorized(userId);

    if (uncategorized.length === 0) {
      res.json({ data: { categorized: 0 } });
      return;
    }

    const results = await Categorizer.categorizeBatch(uncategorized);

    await withTransaction(async (client) => {
      for (const [txnId, catResult] of results) {
        await TransactionModel.setCategory(
          txnId,
          catResult.category_id,
          catResult.confidence,
          client
        );
      }
    });

    res.json({
      data: {
        categorized: results.size,
        breakdown: summarizeCategorization(results),
      },
    });
  })
);

function summarizeCategorization(
  results: Map<number, { category_slug: string; method: string }>
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const [, result] of results) {
    const key = `${result.category_slug} (${result.method})`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

export default router;
