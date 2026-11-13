import { z } from 'zod';

const text = z.string().trim().min(1).max(500);
export const unitSchema = z.enum(['each', 'box', 'pack']);
const money = z.number().finite().nonnegative().max(1_000_000).multipleOf(0.01);

export const orderLineSchema = z.strictObject({
  lineNumber: z.number().int().positive(),
  sku: text.nullable(),
  customerPartNumber: text.nullable(),
  description: text,
  quantity: z.number().finite().positive().max(1_000_000),
  unit: unitSchema,
  unitPrice: money.nullable(),
  confidence: z.number().min(0).max(1),
  evidence: text,
});

export const purchaseOrderSchema = z.strictObject({
  purchaseOrderNumber: text.max(50),
  buyer: text,
  currency: z.literal('USD'),
  lines: z.array(orderLineSchema).min(1).max(100).refine(
    (lines) => new Set(lines.map((line) => line.lineNumber)).size === lines.length,
    'Line numbers must be unique',
  ),
});

export const productSchema = z.strictObject({
  sku: text,
  name: text,
  unit: unitSchema,
  price: money,
  qboItemId: z.string().regex(/^\d+$/),
  aliases: z.array(z.strictObject({ buyer: text, partNumber: text })),
});

export const catalogSchema = z.strictObject({
  seller: text,
  currency: z.literal('USD'),
  products: z.array(productSchema).min(1).refine(
    (items) => new Set(items.map((item) => item.sku.toUpperCase())).size === items.length,
    'Catalog SKUs must be unique',
  ),
});

export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type OrderLine = z.infer<typeof orderLineSchema>;
export type Product = z.infer<typeof productSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
