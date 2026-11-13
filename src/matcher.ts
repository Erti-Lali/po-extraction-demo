import type { Catalog, OrderLine, Product, PurchaseOrder } from './schema.js';

export const REVIEW_THRESHOLD = 0.86;
const AMBIGUITY_MARGIN = 0.12;
const MIN_CANDIDATE_SCORE = 0.45;
export const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const code = (value: string): string => value.trim().toUpperCase();

export interface MatchedLine {
  line: OrderLine;
  product: Product | null;
  method: 'exact-sku' | 'customer-alias' | 'fuzzy-name' | 'unmatched';
  confidence: number;
  status: 'candidate' | 'needs review';
  reasons: string[];
}

function editSimilarity(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length, 1);
}

export function nameSimilarity(left: string, right: string): number {
  const a = normalize(left);
  const b = normalize(right);
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  const overlap = [...wordsA].filter((word) => wordsB.has(word)).length;
  const dice = 2 * overlap / (wordsA.size + wordsB.size);
  return 0.35 * dice + 0.65 * editSimilarity(a, b);
}

export function matchLine(line: OrderLine, buyer: string, catalog: Catalog): MatchedLine {
  const reasons: string[] = [];
  let product: Product | null = null;
  let method: MatchedLine['method'] = 'unmatched';
  let score = 0;
  if (line.sku) {
    product = catalog.products.find((item) => code(item.sku) === code(line.sku!)) ?? null;
    if (product) { method = 'exact-sku'; score = 1; }
    else reasons.push('Supplied SKU is absent from the catalog');
  }
  const aliases = line.customerPartNumber ? catalog.products.filter((item) => item.aliases.some(
    (alias) => normalize(alias.buyer) === normalize(buyer) && code(alias.partNumber) === code(line.customerPartNumber!),
  )) : [];
  if (product && aliases.some((item) => item.sku !== product!.sku)) {
    reasons.push('SKU and customer part number disagree');
  }
  if (!product && aliases.length === 1) {
    product = aliases[0]!; method = 'customer-alias'; score = 0.97;
  } else if (aliases.length > 1) {
    reasons.push('Customer part number maps to multiple products');
  }
  if (line.customerPartNumber && !aliases.length) reasons.push('Customer part number is not mapped for this buyer');
  if (!product) {
    const ranked = catalog.products.map((item) => ({ item, score: nameSimilarity(line.description, item.name) }))
      .sort((a, b) => b.score - a.score || a.item.sku.localeCompare(b.item.sku));
    const best = ranked[0]!;
    score = best.score;
    if (score >= MIN_CANDIDATE_SCORE) {
      product = best.item; method = 'fuzzy-name';
      if (ranked[1] && score - ranked[1].score < AMBIGUITY_MARGIN) reasons.push('Similar catalog alternatives; confirm the specification');
    } else {
      reasons.push('No plausible catalog candidate');
    }
  }
  // Dimensions are meaningful even when an identifier resolves successfully.
  const dimensions = (value: string) => normalize(value).match(/\b[a-z]*\d+[a-z]*\b/g)?.sort().join(',') ?? '';
  if (product && dimensions(line.description) !== dimensions(product.name)) reasons.push('Size or numeric specification differs');
  const rawConfidence = Math.min(score, line.confidence);
  const confidence = Math.round(rawConfidence * 1000) / 1000;
  if (rawConfidence < REVIEW_THRESHOLD) reasons.push(`Confidence below ${REVIEW_THRESHOLD}`);
  if (product && line.unit !== product.unit) reasons.push('Unit mismatch; no automatic pack conversion');
  if (product && line.unitPrice !== null && Math.round(line.unitPrice * 100) !== Math.round(product.price * 100)) {
    reasons.push('PO price differs from catalog price; draft uses catalog price');
  }
  return { line, product, method, confidence, status: reasons.length ? 'needs review' : 'candidate', reasons };
}

export function matchOrder(order: PurchaseOrder, catalog: Catalog): MatchedLine[] {
  return order.lines.map((line) => matchLine(line, order.buyer, catalog));
}
