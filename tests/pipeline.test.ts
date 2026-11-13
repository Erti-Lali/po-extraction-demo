import { describe, expect, it } from 'vitest';
import { OfflineProvider, extractOrder, type ExtractionProvider } from '../src/providers.js';
import { loadCatalog, loadSamples, processOrder } from '../src/pipeline.js';
import { readSource } from '../src/source.js';
import { buildEstimate, estimateSchema } from '../src/estimate.js';
import { matchLine, matchOrder } from '../src/matcher.js';
import { purchaseOrderSchema } from '../src/schema.js';

const expected = [
  { id: 'table', po: 'VEL-1101', pages: 1, quantities: [200, 200, 400], units: ['each', 'each', 'each'],
    skus: ['BLT-M8-Z', 'NUT-M8-Z', 'WSH-M8-Z'], methods: ['exact-sku', 'exact-sku', 'exact-sku'],
    statuses: ['candidate', 'candidate', 'candidate'], prices: [0.45, 0.18, 0.08], total: 158 },
  { id: 'email', po: 'ORV-2202', pages: 1, quantities: [120, 120, 3], units: ['each', 'each', 'pack'],
    skus: ['BLT-M8-Z', 'NUT-M8-Z', 'TIE-200-B'], methods: ['customer-alias', 'customer-alias', 'fuzzy-name'],
    statuses: ['candidate', 'candidate', 'candidate'], prices: [0.45, 0.18, 4.5], total: 89.1 },
  { id: 'multipage', po: 'NIM-3303', pages: 2, quantities: [50, 2, 5, 300], units: ['each', 'box', 'pack', 'each'],
    skus: ['BLT-M10-Z', 'SCR-M4-S', 'TIE-200-B', 'WSH-M8-Z'], methods: ['exact-sku', 'exact-sku', 'exact-sku', 'fuzzy-name'],
    statuses: ['candidate', 'candidate', 'candidate', 'needs review'], prices: [0.68, 8.25, 4.5, 0.08], total: 97 },
];

describe('source → recorded extraction → catalog → QBO draft', () => {
  for (const example of expected) {
    it(`${example.id}: preserves every expected order line and match`, async () => {
      const sample = (await loadSamples()).find((item) => item.id === example.id)!;
      const source = await readSource(sample.file);
      expect(source.pages).toBe(example.pages);
      expect(source.text).toContain(example.po);
      const result = await processOrder(sample, new OfflineProvider(sample.fixture), await loadCatalog());
      const { extraction, matches } = result.review;
      expect(extraction.purchaseOrderNumber).toBe(example.po);
      expect(extraction.lines.map((line) => line.quantity)).toEqual(example.quantities);
      expect(extraction.lines.map((line) => line.unit)).toEqual(example.units);
      expect(matches.map((match) => match.product?.sku)).toEqual(example.skus);
      expect(matches.map((match) => match.method)).toEqual(example.methods);
      expect(matches.map((match) => match.status)).toEqual(example.statuses);
      expect(result.review.approved).toBe(false);
      const estimate = estimateSchema.parse(result.estimate);
      expect(estimate.CustomerRef.value).toBe(sample.qboCustomerId);
      expect(estimate.Line).toHaveLength(example.quantities.length);
      expect(estimate.Line.map((line) => line.SalesItemLineDetail.Qty)).toEqual(example.quantities);
      expect(estimate.Line.map((line) => line.SalesItemLineDetail.UnitPrice)).toEqual(example.prices);
      expect(estimate.Line.map((line) => line.SalesItemLineDetail.ItemRef.value))
        .toEqual(matches.map((match) => match.product!.qboItemId));
      expect(estimate.Line.reduce((sum, line) => sum + line.Amount, 0)).toBeCloseTo(example.total, 2);
      // Evidence words and quantities exist in the actual source, not only in fixtures.
      for (const line of extraction.lines) {
        expect(source.text.replace(/\s+/g, ' ')).toContain(line.description);
        expect(source.text).toContain(String(line.quantity));
      }
    });
  }
});

async function context() {
  const sample = (await loadSamples())[0]!;
  const source = await readSource(sample.file);
  const order = await extractOrder(new OfflineProvider(sample.fixture), source);
  return { sample, source, order, line: order.lines[0]!, catalog: await loadCatalog() };
}

describe('review and validation boundaries', () => {
  it('refuses stale fixtures for changed sources', async () => {
    const { sample, source } = await context();
    await expect(extractOrder(new OfflineProvider(sample.fixture), { ...source, sha256: '0'.repeat(64) }))
      .rejects.toThrow('checksum mismatch');
  });
  it('validates every provider at the shared boundary', async () => {
    const { source } = await context();
    const invalid: ExtractionProvider = { name: 'another-vendor', extract: async () => ({ lines: [] }) };
    await expect(extractOrder(invalid, source)).rejects.toThrow();
  });
  it('rejects invalid quantities, confidence, money, currency, and duplicate lines', async () => {
    const { order, line } = await context();
    for (const quantity of [0, -2, NaN, Infinity]) {
      expect(purchaseOrderSchema.safeParse({ ...order, lines: [{ ...line, quantity }] }).success).toBe(false);
    }
    expect(purchaseOrderSchema.safeParse({ ...order, lines: [{ ...line, confidence: 1.1 }] }).success).toBe(false);
    expect(purchaseOrderSchema.safeParse({ ...order, lines: [{ ...line, unitPrice: 0.001 }] }).success).toBe(false);
    expect(purchaseOrderSchema.safeParse({ ...order, currency: 'EUR' }).success).toBe(false);
    expect(purchaseOrderSchema.safeParse({ ...order, lines: [line, line] }).success).toBe(false);
  });
  it('requires review for unit mismatch, price disagreement, or uncertain extraction', async () => {
    const { order, line, catalog } = await context();
    for (const patch of [{ unit: 'box' as const }, { unitPrice: 0.5 }, { confidence: 0.5 }]) {
      expect(matchLine({ ...line, ...patch }, order.buyer, catalog).status).toBe('needs review');
    }
  });
  it('scopes aliases to a buyer and detects conflicting identifiers', async () => {
    const { order, line, catalog } = await context();
    const alias = { ...line, sku: null, customerPartNumber: 'OV-B08' };
    expect(matchLine(alias, 'Orvella Fabrication (Fictional)', catalog).method).toBe('customer-alias');
    const wrongBuyer = matchLine(alias, order.buyer, catalog);
    expect(wrongBuyer.method).toBe('fuzzy-name');
    expect(wrongBuyer.status).toBe('needs review');
    expect(matchLine({ ...line, customerPartNumber: 'OV-N08' }, 'Orvella Fabrication (Fictional)', catalog).reasons)
      .toContain('SKU and customer part number disagree');
  });
  it('does not accept an unknown SKU or a mismatching size through fuzzy fallback', async () => {
    const { order, line, catalog } = await context();
    expect(matchLine({ ...line, sku: 'UNKNOWN' }, order.buyer, catalog).status).toBe('needs review');
    const match = matchLine({ ...line, sku: null, description: 'Hex bolt M12 zinc plated' }, order.buyer, catalog);
    expect(match.reasons).toContain('Size or numeric specification differs');
  });
  it('never drops unmatched lines or fabricates an ItemRef', async () => {
    const { order, line, catalog, sample } = await context();
    const unknownOrder = { ...order, lines: [{ ...line, sku: null, description: 'Unlisted ceramic cooling module' }] };
    const matches = matchOrder(unknownOrder, catalog);
    expect(matches[0]!.product).toBeNull();
    expect(matches[0]!.status).toBe('needs review');
    expect(buildEstimate(unknownOrder, matches, sample.qboCustomerId)).toBeNull();
    expect(() => buildEstimate(order, [], sample.qboCustomerId)).toThrow('every source line');
  });
  it('rejects a buyer mismatch before assigning a configured QBO customer', async () => {
    const { sample, order, catalog } = await context();
    const provider: ExtractionProvider = { name: 'test', extract: async () => ({ ...order, buyer: 'Another Fictional Buyer' }) };
    await expect(processOrder(sample, provider, catalog)).rejects.toThrow('Buyer differs');
  });
});
