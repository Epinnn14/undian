import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Validates and parses a request body with a Zod schema; errors become a 400 with field paths. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

/** JSON schema for Swagger, generated from the same Zod schema used for validation. */
export function openApi(schema: z.ZodType) {
  // biome-ignore lint/suspicious/noExplicitAny: swagger's SchemaObject type is looser than JSON Schema
  return z.toJSONSchema(schema, { target: 'openapi-3.0' }) as any;
}
