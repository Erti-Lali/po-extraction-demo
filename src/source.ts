import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

export interface SourceDocument {
  name: string;
  text: string;
  sha256: string;
  pages: number;
}

/** Read a text PDF or the deliberately plain-text email sample, without an LLM. */
export async function readSource(path: string): Promise<SourceDocument> {
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  let text: string;
  let pages = 1;
  if (extname(path).toLowerCase() === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    try {
      pages = pdf.numPages;
      if (pages > 20) throw new Error('This demo accepts at most 20 PDF pages.');
      const chunks: string[] = [];
      for (let index = 1; index <= pages; index++) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        const body = content.items.map((item) =>
          'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
        ).join('');
        if (!body.trim()) throw new Error(`Page ${index} has no text; OCR is outside this demo.`);
        chunks.push(`[Page ${index}]\n${body}`);
      }
      text = chunks.join('\n\n');
    } finally {
      await pdf.destroy();
    }
  } else if (['.eml', '.txt'].includes(extname(path).toLowerCase())) {
    text = bytes.toString('utf8');
    // The included .eml is 7-bit text. Production MIME decoding is out of scope.
  } else {
    throw new Error('Supported source formats: .pdf, .eml, .txt');
  }
  if (!text.trim()) throw new Error('Source has no text.');
  return { name: basename(path), text, sha256, pages };
}
