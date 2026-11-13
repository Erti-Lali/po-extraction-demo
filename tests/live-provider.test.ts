import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, extractOrder } from '../src/providers.js';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create }; },
}));

const source = { name: 'synthetic.txt', text: 'Fictional test document', sha256: '0'.repeat(64), pages: 1 };
const extraction = {
  purchaseOrderNumber: 'TEST-1', buyer: 'Synthetic Buyer (Fictional)', currency: 'USD',
  lines: [{ lineNumber: 1, sku: null, customerPartNumber: null, description: 'Test item', quantity: 1,
    unit: 'each', unitPrice: null, confidence: 0.9, evidence: 'Test item' }],
};

describe('live adapter contract (mocked; no API calls)', () => {
  beforeEach(() => create.mockReset());
  it('requires a key only for an explicitly constructed live provider', () => {
    expect(() => new AnthropicProvider('', 'test-model')).toThrow('ANTHROPIC_API_KEY');
  });
  it('sends document text with a schema and validates the JSON response', async () => {
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(extraction) }] });
    expect(await extractOrder(new AnthropicProvider('synthetic-test-token', 'test-model'), source)).toEqual(extraction);
    expect(create.mock.calls[0]![0].messages[0].content).toContain(source.text);
    expect(create.mock.calls[0]![0].output_config.format.schema.type).toBe('object');
  });
  it.each(['max_tokens', 'tool_use', 'refusal'])('rejects incomplete/refused output (%s)', async (stop_reason: string) => {
    create.mockResolvedValue({ stop_reason, content: [] });
    await expect(extractOrder(new AnthropicProvider('synthetic-test-token', 'test-model'), source)).rejects.toThrow('complete');
  });
  it('rejects malformed extracted data through Zod', async () => {
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
    await expect(extractOrder(new AnthropicProvider('synthetic-test-token', 'test-model'), source)).rejects.toThrow();
  });
  it('rejects invalid JSON rather than recovering partial output', async () => {
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{' }] });
    await expect(extractOrder(new AnthropicProvider('synthetic-test-token', 'test-model'), source)).rejects.toThrow();
  });
});
