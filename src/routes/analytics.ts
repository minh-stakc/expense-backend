import { Router, Request, Response } from 'express';
import * as AnalyticsService from '../services/analytics';
import * as BudgetModel from '../models/budget';
import * as Categorizer from '../services/categorizer';
import { validate } from '../middleware/validation';
import { asyncHandler, notFound } from '../middleware/errorHandler';
import {
  AnalyticsQuerySchema,
  CreateBudgetSchema,
  UpdateBudgetSchema,
} from '../types';
import { z } from 'zod';

const router = Router();

// ─── GET /analytics/monthly — Monthly spending summaries ─────────────

router.get(
  '/monthly',
  validate(AnalyticsQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const summaries = await AnalyticsService.getMonthlySummaries(req.query as any);
    res.json({ data: summaries });
  })
);

// ─── GET /analytics/categories — Spending by category ────────────────

router.get(
  '/categories',
  validate(AnalyticsQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const breakdown = await AnalyticsService.getCategoryBreakdown(req.query as any);
    res.json({ data: breakdown });
  })
);

// ─── GET /analytics/trends — Month-over-month spending trends ────────

const TrendsQuerySchema = AnalyticsQuerySchema.extend({
  months: z.coerce.number().int().min(2).max(24).default(6),
});

router.get(
  '/trends',
  validate(TrendsQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const trends = await AnalyticsService.getSpendingTrends(req.query as any);
    res.json({ data: trends });
  })
);

// ─── GET /analytics/daily — Daily spending for charting ──────────────

const DailyQuerySchema = z.object({
  user_id: z.coerce.number().int().positive(),
  from_date: z.string().date(),
  to_date: z.string().date(),
});

router.get(
  '/daily',
  validate(DailyQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const { user_id, from_date, to_date } = req.query as any;
    const daily = await AnalyticsService.getDailySpending(user_id, from_date, to_date);
    res.json({ data: daily });
  })
);

// ─── GET /analytics/subscriptions — Detected recurring charges ───────

router.get(
  '/subscriptions',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseInt(String(req.query.user_id), 10);
    if (isNaN(userId)) {
      res.status(400).json({ status: 400, message: 'user_id query param required' });
      return;
    }

    const subscriptions = await Categorizer.detectSubscriptions(userId);
    res.json({ data: subscriptions });
  })
);

// ─── GET /analytics/budgets — Budget status for a user ───────────────

router.get(
  '/budgets',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseInt(String(req.query.user_id), 10);
    if (isNaN(userId)) {
      res.status(400).json({ status: 400, message: 'user_id query param required' });
      return;
    }

    const statuses = await BudgetModel.getBudgetStatuses(userId);
    res.json({ data: statuses });
  })
);

// ─── POST /analytics/budgets — Create a budget ──────────────────────

router.post(
  '/budgets',
  validate(CreateBudgetSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const budget = await BudgetModel.create(req.body);
    res.status(201).json({ data: budget });
  })
);

// ─── PATCH /analytics/budgets/:id — Update a budget ──────────────────

router.patch(
  '/budgets/:id',
  validate(UpdateBudgetSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Budget not found');

    const budget = await BudgetModel.update(id, req.body);
    if (!budget) throw notFound('Budget not found');

    res.json({ data: budget });
  })
);

// ─── DELETE /analytics/budgets/:id ───────────────────────────────────

router.delete(
  '/budgets/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Budget not found');

    const deleted = await BudgetModel.remove(id);
    if (!deleted) throw notFound('Budget not found');

    res.status(204).send();
  })
);

// ─── POST /analytics/refresh — Refresh materialized views ────────────

router.post(
  '/refresh',
  asyncHandler(async (_req: Request, res: Response) => {
    await AnalyticsService.refreshAnalyticViews();
    res.json({ message: 'Analytics views refreshed successfully' });
  })
);

export default router;
