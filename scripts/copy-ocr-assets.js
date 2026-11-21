// Copies the OCR engine and its language data into public/, so scanned PDFs are read without any outside service.
// Also copies GSAP next to the pipeline user guide (public/guide), which animates with it.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'public', 'ocr');
const copies = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/tha/4.0.0_best_int/tha.traineddata.gz', 'lang/tha.traineddata.gz'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
];

for (const [from, to] of copies) {
  const destination = path.join(target, to);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, from), destination);
}

for (const file of ['gsap.min.js', 'ScrollTrigger.min.js']) {
  const destination = path.join(root, 'public', 'guide', file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, 'node_modules/gsap/dist', file), destination);
}
