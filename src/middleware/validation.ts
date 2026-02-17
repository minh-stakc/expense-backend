import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type RequestField = 'body' | 'query' | 'params';

/**
 * Express middleware factory that validates a request field against a Zod schema.
 * On success, replaces the field with the parsed (and coerced) value.
 * On failure, returns a 400 with structured validation errors.
 */
export function validate(schema: ZodSchema, field: RequestField = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[field]);

    if (!result.success) {
      const errors = formatZodError(result.error);
      res.status(400).json({
        status: 400,
        message: 'Validation failed',
        details: errors,
      });
      return;
    }

    // Replace with parsed + coerced values
    (req as unknown as Record<string, unknown>)[field] = result.data;
    next();
  };
}

/**
 * Validate multiple fields at once.
 */
export function validateMultiple(
  schemas: Partial<Record<RequestField, ZodSchema>>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allErrors: Array<{ field: string; path: string; message: string }> = [];

    for (const [field, schema] of Object.entries(schemas) as [RequestField, ZodSchema][]) {
      const result = schema.safeParse(req[field]);
      if (!result.success) {
        allErrors.push(
          ...result.error.issues.map((issue) => ({
            field,
            path: issue.path.join('.'),
            message: issue.message,
          }))
        );
      } else {
        (req as unknown as Record<string, unknown>)[field] = result.data;
      }
    }

    if (allErrors.length > 0) {
      res.status(400).json({
        status: 400,
        message: 'Validation failed',
        details: allErrors,
      });
      return;
    }

    next();
  };
}

function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
