import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { AnthropicProvider, OfflineProvider } from './providers.js';
import { loadCatalog, loadSamples, processOrder } from './pipeline.js';

async function main() {
  const { values } = parseArgs({ options: {
    mode: { type: 'string', default: 'offline' }, sample: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: npm run demo -- [--mode offline|live] [--sample table|email|multipage]');
    return;
  }
  if (!['offline', 'live'].includes(values.mode!)) throw new Error('Mode must be offline or live.');
  const samples = (await loadSamples()).filter((sample) => !values.sample || sample.id === values.sample);
  if (!samples.length) throw new Error('Unknown sample. Choose table, email, or multipage.');
  const live = values.mode === 'live' ? new AnthropicProvider(
    process.env.ANTHROPIC_API_KEY ?? '', process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
  ) : null;
  const catalog = await loadCatalog();
  await mkdir('output', { recursive: true });
  for (const sample of samples) {
    const provider = live ?? new OfflineProvider(sample.fixture);
    const result = await processOrder(sample, provider, catalog);
    console.log(`\n${sample.id.toUpperCase()} | ${result.review.extraction.purchaseOrderNumber} | ${provider.name} | ${result.review.source.pages} page(s)`);
    console.table(result.review.matches.map(({ line, product, confidence, method, status, reasons }) => ({
      Line: line.lineNumber, Description: line.description, Qty: line.quantity, Unit: line.unit,
      SKU: product?.sku ?? 'UNMATCHED', 'Catalog USD': product?.price ?? '-',
      Confidence: `${(confidence * 100).toFixed(1)}%`, Method: method, Status: status,
      Review: reasons.join('; '),
    })));
    await writeFile(`output/${sample.id}.estimate.json`, JSON.stringify(result.estimate, null, 2) + '\n');
    await writeFile(`output/${sample.id}.review.json`, JSON.stringify(result.review, null, 2) + '\n');
    console.log(`Draft: output/${sample.id}.estimate.json | Review: output/${sample.id}.review.json`);
    console.log(`Status: ${result.review.status}. Human approval required; nothing is sent to QBO.`);
  }
}

main().catch(() => {
  // SDK errors can contain request details. Keep credentials and document text out of logs.
  console.error('Demo failed. Check input/schema, fixture checksum, or live credentials/model. Run npm test for offline diagnostics.');
  process.exitCode = 1;
});
