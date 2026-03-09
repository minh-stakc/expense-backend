import { Router, Request, Response } from 'express';
import * as CategoryModel from '../models/category';
import { invalidateCache } from '../services/categorizer';
import { validate } from '../middleware/validation';
import { asyncHandler, notFound } from '../middleware/errorHandler';
import { CreateCategorySchema, UpdateCategorySchema } from '../types';

const router = Router();

// ─── GET /categories — List all categories ───────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const categories = await CategoryModel.findAll();
    res.json({ data: categories });
  })
);

// ─── GET /categories/:id — Single category ──────────────────────────

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Category not found');

    const category = await CategoryModel.findById(id);
    if (!category) throw notFound('Category not found');

    res.json({ data: category });
  })
);

// ─── POST /categories — Create a new category ───────────────────────

router.post(
  '/',
  validate(CreateCategorySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const category = await CategoryModel.create(req.body);
    invalidateCache();
    res.status(201).json({ data: category });
  })
);

// ─── PATCH /categories/:id — Update a category ──────────────────────

router.patch(
  '/:id',
  validate(UpdateCategorySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Category not found');

    const category = await CategoryModel.update(id, req.body);
    if (!category) throw notFound('Category not found');

    invalidateCache();
    res.json({ data: category });
  })
);

// ─── DELETE /categories/:id ──────────────────────────────────────────

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) throw notFound('Category not found');

    const deleted = await CategoryModel.remove(id);
    if (!deleted) throw notFound('Category not found');

    invalidateCache();
    res.status(204).send();
  })
);

export default router;
