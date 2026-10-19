// The BOUNDS.md standard layout (see SPEC.md), and the test for "only the layout changed".
import crypto from 'node:crypto';
import { parse, isGlossary, normText, VERSION_MARKER_RE } from './parse.mjs';

export const SPEC_VERSION = 1;
export const VERSION_MARKER = `<!-- bounds-md v${SPEC_VERSION} -->`;

const STANDARD = ['Product', 'Architecture', 'UI', 'Backend', 'Data', 'Testing', 'Security', 'Dependencies', 'Process'];
const CANONICAL_TITLE = new Map([...STANDARD, 'Glossary'].map((t) => [t.toLowerCase(), t]));

function sectionRank(section, index) {
  if (isGlossary(section)) return [2, 0];
  const std = STANDARD.findIndex((t) => t.toLowerCase() === section.title.toLowerCase());
  return std === -1 ? [1, index] : [0, std];
}

// The prefix most rules in the section already use; otherwise one derived from the title.
export function sectionPrefix(section) {
  const counts = new Map();
  for (const r of section.rules) {
    const p = r.id?.replace(/-\d+$/, '');
    if (p) counts.set(p, (counts.get(p) || 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  return section.title.toUpperCase().replace(/[^A-Z0-9]+/g, '') || 'RULE';
}

function idNumber(id) {
  return Number(id.match(/-(\d+)$/)[1]);
}

function formatRules(section, used) {
  const prefix = sectionPrefix(section);
  const own = (r) => r.id && r.id.startsWith(prefix + '-');
  let next = Math.max(0, ...[...used].filter((id) => id.startsWith(prefix + '-')).map(idNumber)) + 1;
  const assigned = section.rules.map((r) => {
    if (r.id) return { ...r };
    const id = `${prefix}-${next++}`;
    used.add(id);
    return { ...r, id };
  });
  const sorted = [
    ...assigned.filter(own).sort((a, b) => idNumber(a.id) - idNumber(b.id)),
    ...assigned.filter((r) => !own(r)).sort((a, b) => a.id.localeCompare(b.id)),
  ];
  return sorted.map((r) => `- ${r.id} ${r.level} ${normText(r.text)}`);
}

function formatTerm(t) {
  let line = `- ${t.names.join(' = ')}`;
  if (t.meaning) line += ` — ${normText(t.meaning)}`;
  if (t.avoid.length) line += ` · avoid: ${t.avoid.join(', ')}`;
  return line;
}

export function format(text) {
  const doc = parse(text);
  const used = new Set(doc.sections.flatMap((s) => s.rules.map((r) => r.id).filter(Boolean)));

  const head = [doc.title || '# BOUNDS.md', VERSION_MARKER];
  const out = [head.join('\n'), ...doc.preamble];

  const ordered = doc.sections
    .map((s, i) => ({ s, rank: sectionRank(s, i) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map(({ s }) => s);

  for (const s of ordered) {
    const lines = [`## ${CANONICAL_TITLE.get(s.title.toLowerCase()) || s.title}`, ...s.notes];
    lines.push(s.owner ? `owner: ${s.owner}` : 'owner:');
    if (s.hasScope) lines.push(s.scope ? `scope: ${s.scope}` : 'scope:');
    if (isGlossary(s)) {
      const terms = [...s.terms].sort((a, b) => (a.names[0] || '').localeCompare(b.names[0] || ''));
      lines.push(...terms.map(formatTerm));
    } else {
      lines.push(...formatRules(s, used));
    }
    lines.push(...s.bad);
    out.push(lines.join('\n'));
  }
  return out.join('\n\n') + '\n';
}

export function isFormatted(text) {
  return format(text) === text;
}

// Everything a person wrote, with layout stripped: section names, owners, scopes, notes, rules, terms.
function content(text) {
  const doc = parse(text);
  const norm = (s) => normText(s);
  return {
    title: doc.title ? norm(doc.title) : null,
    preamble: doc.preamble.map(norm).sort(),
    sections: doc.sections
      .map((s) => ({
        title: s.title.toLowerCase(),
        owner: s.owner,
        scope: s.scope,
        notes: s.notes.map(norm).sort(),
        bad: s.bad.map(norm).sort(),
        rules: s.rules.map((r) => ({ id: r.id, key: `${r.level}|${norm(r.text)}` })),
        terms: s.terms.map((t) => [t.names.join('='), t.meaning ? norm(t.meaning) : '', [...t.avoid].sort().join(',')].join('|')).sort(),
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

const json = (x) => JSON.stringify(x);

// Rules match by level + text. A rule may gain an ID it didn't have, but never lose or change one.
function sameRules(before, after) {
  if (before.length !== after.length) return false;
  const pool = [...after];
  for (const r of before) {
    const i = pool.findIndex((a) => a.key === r.key && (r.id === null || a.id === r.id));
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return true;
}

export function sameContent(beforeText, afterText) {
  const a = content(beforeText);
  const b = content(afterText);
  if (a.title !== null && a.title !== b.title) return false;
  if (json(a.preamble) !== json(b.preamble) || a.sections.length !== b.sections.length) return false;
  return a.sections.every((s, i) => {
    const t = b.sections[i];
    const { rules: r1, ...rest1 } = s;
    const { rules: r2, ...rest2 } = t;
    return json(rest1) === json(rest2) && sameRules(r1, r2);
  });
}

// Changes when the content changes, not when only the layout does (new IDs from doctor included).
export function contentHash(text) {
  const c = content(text);
  for (const s of c.sections) s.rules = s.rules.map((r) => r.key).sort();
  return crypto.createHash('sha256').update(json(c)).digest('hex').slice(0, 16);
}

export function specVersion(text) {
  const marker = text.split('\n').map((l) => l.trim()).find((l) => VERSION_MARKER_RE.test(l));
  return marker ? Number(marker.match(VERSION_MARKER_RE)[1]) : null;
}
