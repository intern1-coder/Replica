#!/usr/bin/env node
// ── PII-in-logs regression guard ─────────────────────────────────────────────────
// Fails if a logger.*() call passes a known raw-PII key directly in its metadata.
// The logger has a redaction safety net (src/lib/logger.ts), but the primary rule
// is: don't put PII in log metadata at all. Log identifiers (userId) or masked
// values (maskEmail) instead. See docs/PRODUCTION_HARDENING.md.
//
// This is a deliberately simple line-based scan — it flags the raw key names, not
// the already-safe masked variants (maskedEmail, maskedTo).
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(import.meta.dirname, '..', 'src');

// Raw PII keys that must never be logged directly.
const FORBIDDEN = ['email', 'phone', 'phoneNumber', 'address', 'accessNotes', 'keyLocation', 'passwordHash'];
// e.g. matches `{ email }` or `email:` but NOT `maskedEmail:` / `emailMasked`.
const pattern = new RegExp(`(?<![A-Za-z])(${FORBIDDEN.join('|')})\\s*[:}]`);
const loggerCall = /logger\.(info|debug|warn|error|http)\(/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Look for a logger call, then scan it and the next few lines for a forbidden key.
    if (!loggerCall.test(line)) return;
    const block = lines.slice(i, i + 6).join('\n');
    const call = block.slice(0, block.indexOf(');') + 1 || block.length);
    const m = call.match(pattern);
    if (m) {
      violations.push(`${relative(SRC, file)}:${i + 1}  logs raw PII key "${m[1]}"`);
    }
  });
}

if (violations.length) {
  console.error('PII-in-logs check FAILED. Log an identifier or a masked value instead:\n');
  for (const v of violations) console.error('  ' + v);
  console.error('\nSee docs/PRODUCTION_HARDENING.md (Logging policy).');
  process.exit(1);
}
console.log('PII-in-logs check passed.');
