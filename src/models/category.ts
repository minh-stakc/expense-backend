import { query } from '../db/connection';
import { CategoryRow, CreateCategoryInput, UpdateCategoryInput } from '../types';

export async function findAll(): Promise<CategoryRow[]> {
  const result = await query<CategoryRow>(
    `SELECT id, name, slug, parent_id, keywords, icon, created_at
     FROM categories
     ORDER BY name ASC`
  );
  return result.rows;
}

export async function findById(id: number): Promise<CategoryRow | null> {
  const result = await query<CategoryRow>(
    `SELECT id, name, slug, parent_id, keywords, icon, created_at
     FROM categories
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function findBySlug(slug: string): Promise<CategoryRow | null> {
  const result = await query<CategoryRow>(
    `SELECT id, name, slug, parent_id, keywords, icon, created_at
     FROM categories
     WHERE slug = $1`,
    [slug]
  );
  return result.rows[0] ?? null;
}

export async function create(input: CreateCategoryInput): Promise<CategoryRow> {
  const result = await query<CategoryRow>(
    `INSERT INTO categories (name, slug, parent_id, keywords, icon)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.name, input.slug, input.parent_id ?? null, input.keywords, input.icon ?? null]
  );
  return result.rows[0];
}

export async function update(id: number, input: UpdateCategoryInput): Promise<CategoryRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(input.name);
  }
  if (input.keywords !== undefined) {
    sets.push(`keywords = $${idx++}`);
    params.push(input.keywords);
  }
  if (input.icon !== undefined) {
    sets.push(`icon = $${idx++}`);
    params.push(input.icon);
  }

  if (sets.length === 0) return findById(id);

  params.push(id);
  const result = await query<CategoryRow>(
    `UPDATE categories SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0] ?? null;
}

export async function remove(id: number): Promise<boolean> {
  const result = await query('DELETE FROM categories WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Load all categories with their keywords for the categorizer engine. */
export async function findAllWithKeywords(): Promise<Pick<CategoryRow, 'id' | 'slug' | 'keywords'>[]> {
  const result = await query<Pick<CategoryRow, 'id' | 'slug' | 'keywords'>>(
    `SELECT id, slug, keywords FROM categories WHERE array_length(keywords, 1) > 0`
  );
  return result.rows;
}
