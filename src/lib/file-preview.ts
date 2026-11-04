export type PreviewKind = 'IMAGE' | 'PDF' | 'WORKBOOK' | 'CSV' | 'TEXT' | 'NONE';

const BY_EXTENSION: Record<string, PreviewKind> = {
  jpg: 'IMAGE',
  jpeg: 'IMAGE',
  png: 'IMAGE',
  webp: 'IMAGE',
  gif: 'IMAGE',
  pdf: 'PDF',
  xlsx: 'WORKBOOK',
  csv: 'CSV',
  txt: 'TEXT',
};

/** How a document can be shown in the browser, by file name; old formats like .xls and .doc cannot be. */
export function previewKind(fileName: string): PreviewKind {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return fileName.includes('.') ? (BY_EXTENSION[ext] ?? 'NONE') : 'NONE';
}
