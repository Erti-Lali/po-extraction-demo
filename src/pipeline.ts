import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { catalogSchema, type Catalog } from './schema.js';
import { extractOrder, type ExtractionProvider } from './providers.js';
import { readSource } from './source.js';
import { matchOrder } from './matcher.js';
import { buildEstimate } from './estimate.js';

const sampleSchema = z.strictObject({
  id: z.string().regex(/^[a-z]+$/), file: z.string(), fixture: z.string(),
  buyer: z.string(), qboCustomerId: z.string().regex(/^\d+$/),
});
export type Sample = z.infer<typeof sampleSchema>;
export async function loadSamples(): Promise<Sample[]> {
  return z.array(sampleSchema).parse(JSON.parse(await readFile('samples/manifest.json', 'utf8')));
}
export async function loadCatalog(): Promise<Catalog> {
  return catalogSchema.parse(JSON.parse(await readFile('catalog.json', 'utf8')));
}

export async function processOrder(sample: Sample, provider: ExtractionProvider, catalog: Catalog) {
  const source = await readSource(sample.file);
  const order = await extractOrder(provider, source);
  // CustomerRef comes from trusted configuration, never from an LLM-generated ID.
  if (order.buyer !== sample.buyer) throw new Error('Buyer differs from configured customer; review required.');
  if (order.currency !== catalog.currency) throw new Error('Currency differs from catalog.');
  const matches = matchOrder(order, catalog);
  const estimate = buildEstimate(order, matches, sample.qboCustomerId);
  return {
    estimate,
    review: {
      sampleId: sample.id,
      source: { file: sample.file, sha256: source.sha256, pages: source.pages },
      provider: provider.name,
      status: matches.some((match) => match.status === 'needs review') ? 'needs review' : 'awaiting approval',
      approved: false,
      extraction: order,
      matches,
    },
  };
}
