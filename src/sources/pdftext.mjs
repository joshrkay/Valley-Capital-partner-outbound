// The text layer of a PDF, read by `pdftotext` from poppler-utils, run as a child process (docs/county-loans.md, the Caldwell reader).
// No npm dependency reads PDFs: a scanned county notice carries an OCR text layer that poppler reads well, and src/sources/fdicsales.mjs
// pdfText only reads simple single-byte text streams. The PDF goes in on stdin and the text comes out on stdout, so nothing is written
// to disk. The text is held in memory for the parser only: it is never stored, logged or returned in a run's result.
//
// Install: `apt-get install -y poppler-utils` (the platform worker's workflow does it before the weekly county run).
import { spawn } from 'node:child_process';

export class PdfToolMissing extends Error {
  constructor(bin) { super(`${bin} is not installed. It comes with poppler-utils: apt-get install -y poppler-utils (macOS: brew install poppler).`); this.name = 'PdfToolMissing'; }
}

// Whether pdftotext can be run here, for a test to skip what needs it.
export function hasPdfToText(bin = 'pdftotext') {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(bin, ['-v'], { stdio: 'ignore' }); } catch { resolve(false); return; }
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(true));
  });
}

// bytes (a Buffer) -> { text, readable, reason, pages }. `layout` keeps each line's columns, so a labelled block ("DATE:  ...") stays on
// one line. A PDF with no text layer, or one poppler cannot open, is unreadable with a reason, never an error; a missing pdftotext is an
// error (PdfToolMissing), because then no notice can be read and the run must stop.
export function pdfToText(bytes, { layout = true, timeoutMs = 60000, maxChars = 2_000_000, bin = 'pdftotext' } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return Promise.resolve({ text: '', readable: false, reason: 'not a PDF', pages: 0 });
  return new Promise((resolve, reject) => {
    const args = [...(layout ? ['-layout'] : []), '-enc', 'UTF-8', '-q', '-', '-'];
    let p;
    try { p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] }); } catch (e) { reject(e.code === 'ENOENT' ? new PdfToolMissing(bin) : e); return; }
    const out = [];
    let n = 0, over = false, done = false;
    const finish = (fn) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => { p.kill('SIGKILL'); finish(() => resolve({ text: '', readable: false, reason: `${bin} took longer than ${Math.round(timeoutMs / 1000)} seconds`, pages: 0 })); }, timeoutMs);
    p.on('error', (e) => finish(() => (e.code === 'ENOENT' ? reject(new PdfToolMissing(bin)) : reject(e))));
    p.stdout.on('data', (c) => { if (over) return; n += c.length; if (n > maxChars * 4) { over = true; p.kill('SIGKILL'); return; } out.push(c); });
    p.on('close', (code) => finish(() => {
      if (over) return resolve({ text: '', readable: false, reason: 'more text than a notice holds', pages: 0 });
      if (code !== 0) return resolve({ text: '', readable: false, reason: `${bin} could not read it (exit ${code})`, pages: 0 });
      const text = Buffer.concat(out).toString('utf8').slice(0, maxChars);
      const pages = text.split('\f').filter((pg) => pg.trim()).length;
      const letters = (text.match(/[A-Za-z]/g) ?? []).length;
      if (letters < 200) return resolve({ text: '', readable: false, reason: 'no text layer (an image with no OCR)', pages });
      resolve({ text, readable: true, reason: null, pages });
    }));
    p.stdin.on('error', () => {});   // the tool may exit before reading everything (a broken PDF); its exit code says so
    p.stdin.end(buf);
  });
}
