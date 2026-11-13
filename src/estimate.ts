import { z } from 'zod';
import type { PurchaseOrder } from './schema.js';
import type { MatchedLine } from './matcher.js';

/** A small, explicit subset of the QBO Estimate create body. IDs are placeholders. */
export const estimateSchema = z.strictObject({
  CustomerRef: z.strictObject({ value: z.string().regex(/^\d+$/) }),
  PrivateNote: z.string(),
  Line: z.array(z.strictObject({
    DetailType: z.literal('SalesItemLineDetail'),
    Description: z.string(),
    Amount: z.number().finite().nonnegative(),
    SalesItemLineDetail: z.strictObject({
      ItemRef: z.strictObject({ value: z.string().regex(/^\d+$/), name: z.string() }),
      Qty: z.number().finite().positive(),
      UnitPrice: z.number().finite().nonnegative(),
    }),
  })).min(1),
});

export function buildEstimate(order: PurchaseOrder, matches: MatchedLine[], customerId: string) {
  if (matches.length !== order.lines.length || matches.some((match, i) => match.line !== order.lines[i])) {
    throw new Error('Estimate matches must cover every source line in order.');
  }
  // Never invent an ItemRef or silently omit an unmatched line.
  if (matches.some((match) => !match.product)) return null;
  return estimateSchema.parse({
    CustomerRef: { value: customerId },
    PrivateNote: `DRAFT - human approval required. Source PO: ${order.purchaseOrderNumber}`,
    Line: matches.map(({ line, product }) => ({
      DetailType: 'SalesItemLineDetail',
      Description: `${line.description} [${product!.sku}]`,
      Amount: Math.round(Math.round(product!.price * 100) * line.quantity) / 100,
      SalesItemLineDetail: {
        ItemRef: { value: product!.qboItemId, name: product!.name },
        Qty: line.quantity,
        UnitPrice: product!.price,
      },
    })),
  });
}
