import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

/**
 * The text a PDF prints, squashed for matching: whitespace removed, and Thai sara am written as one
 * character, since a PDF may store it as nikhahit + sara aa
 */
export async function pdfText(buffer: Buffer): Promise<string> {
  // verbosity 0: errors only; reading text needs no standard-font data, so pdf.js's warning about it is noise
  const doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    let text = '';
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      text += content.items.map((item) => ('str' in item ? item.str : '')).join('');
    }
    return text.normalize('NFC').replace(/ํา/g, 'ำ').replace(/\s+/g, '');
  } finally {
    await doc.destroy();
  }
}
