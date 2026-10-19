// Where BOUNDS.md files live and which of their parts apply to a path — the same loading model as CLAUDE.md:
// files in the project directory and above load at start, files in subdirectories load on demand,
// and a section with "scope:" loads when Claude works on a matching file (like .claude/rules "paths:").
import fs from 'node:fs';
import path from 'node:path';
import { findBoundsMd, check } from './lib.mjs';
import { parse } from './parse.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.cache']);

// BOUNDS.md in the project directory and every directory above it, outermost first.
export function ancestorFiles(projectDir) {
  const found = [];
  let dir = path.resolve(projectDir);
  for (;;) {
    const f = findBoundsMd(dir);
    if (f) found.unshift(f);
    const parent = path.dirname(dir);
    if (parent === dir) return found;
    dir = parent;
  }
}

// BOUNDS.md in subdirectories of the project between the project root and `filePath`, outermost first.
export function nestedFilesFor(projectDir, filePath) {
  const root = path.resolve(projectDir);
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, path.dirname(abs));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return [];
  const found = [];
  let dir = root;
  for (const part of rel.split(path.sep)) {
    dir = path.join(dir, part);
    const f = findBoundsMd(dir);
    if (f) found.push(f);
  }
  return found;
}

// Every BOUNDS.md under the project, for the doctor.
export function allFiles(projectDir) {
  const out = [];
  const walk = (dir, depth) => {
    const f = findBoundsMd(dir);
    if (f) out.push(f);
    if (depth > 12) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(path.resolve(projectDir), 0);
  return out;
}

// Glob → RegExp: ** any depth, * within a segment, ? one char, {a,b} alternatives.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function scopePatterns(scope) {
  return (scope || '').split(',').map((s) => s.trim().replace(/^\.\//, '')).filter(Boolean);
}

// Does a section scope (relative to its BOUNDS.md's directory) cover `filePath`?
export function inScope(scope, boundsFile, filePath) {
  const rel = path.relative(path.dirname(boundsFile), path.resolve(filePath)).split(path.sep).join('/');
  if (rel.startsWith('..')) return false;
  return scopePatterns(scope).some((p) => {
    const re = globToRegExp(p);
    // "src/ui" with no wildcard means the directory and everything in it.
    return re.test(rel) || (!/[*?{]/.test(p) && (rel === p || rel.startsWith(p.replace(/\/$/, '') + '/')));
  });
}

// Splits the file text into its sections by line ranges, so a section can be shown in full or as a one-line summary.
function sectionBlocks(text) {
  const lines = text.split('\n');
  const doc = parse(text);
  return doc.sections.map((s, i) => {
    const start = s.line - 1;
    const end = i + 1 < doc.sections.length ? doc.sections[i + 1].line - 1 : lines.length;
    return { section: s, text: lines.slice(start, end).join('\n').trimEnd() };
  });
}

// The file as Claude sees it at load time: scoped sections are reduced to a summary until Claude works in their scope.
export function loadView(text) {
  const blocks = sectionBlocks(text);
  if (!blocks.length) return text.trim();
  const lines = text.split('\n');
  const head = lines.slice(0, blocks[0].section.line - 1).join('\n').trim();
  const parts = blocks.map(({ section: s, text: full }) => {
    if (!s.scope || !s.rules.length) return full;
    const ids = s.rules.map((r) => r.id).filter(Boolean).join(', ');
    return `## ${s.title}\nscope: ${s.scope}\n(${s.rules.length} rule(s)${ids ? `: ${ids}` : ''} — the full text loads when you read or edit a file in this scope)`;
  });
  return [head, ...parts].filter(Boolean).join('\n\n');
}

// Scoped sections of `boundsFile` that cover `filePath`, with their full text.
export function scopedSectionsFor(boundsFile, text, filePath) {
  return sectionBlocks(text)
    .filter(({ section: s }) => s.scope && s.rules.length && inScope(s.scope, boundsFile, filePath))
    .map(({ section: s, text: full }) => ({ title: s.title, scope: s.scope, text: full }));
}

// Places where one BOUNDS.md overrides or shadows another. Advisory: people decide what to change.
// `files` is [{ rel, file, text }]; a file applies to its own directory and below.
export function crossCheck(files) {
  const warnings = [];
  const parsed = files.map((f) => ({ ...f, dir: path.dirname(f.file), doc: check(f.text) }));
  const covers = (outer, inner) => inner.dir === outer.dir || inner.dir.startsWith(outer.dir + path.sep);

  for (const a of parsed) {
    for (const b of parsed) {
      if (a === b || !covers(a, b)) continue; // b is nested in a (or in the same directory)
      const aIds = new Set(a.doc.sections.flatMap((s) => s.rules.map((r) => r.id)).filter(Boolean));
      for (const r of b.doc.sections.flatMap((s) => s.rules)) {
        if (r.id && aIds.has(r.id)) warnings.push(`${r.id} exists in both ${a.rel} and ${b.rel} — references become ambiguous; give ${b.rel} its own ID prefix`);
      }
      const aTerms = new Map(a.doc.terms.flatMap((t) => t.names.map((n) => [n.toLowerCase(), t])));
      for (const t of b.doc.terms) {
        for (const n of t.names) {
          const base = aTerms.get(n.toLowerCase());
          if (!base) continue;
          if ((base.meaning || '') !== (t.meaning || '')) warnings.push(`term "${n}" in ${b.rel} redefines the one in ${a.rel} — the same word means two things; use a different term`);
          else warnings.push(`term "${n}" in ${b.rel} repeats ${a.rel} — remove the copy`);
        }
        for (const w of t.avoid) {
          if (aTerms.has(w.toLowerCase())) warnings.push(`${b.rel} says to avoid "${w}", which is a term in ${a.rel}`);
        }
      }
      for (const t of a.doc.terms) {
        for (const w of t.avoid) {
          if (b.doc.terms.some((bt) => bt.names.some((n) => n.toLowerCase() === w.toLowerCase()))) warnings.push(`"${w}" is avoided in ${a.rel} but defined as a term in ${b.rel}`);
        }
      }
    }
    for (const s of a.doc.sections) {
      for (const p of scopePatterns(s.scope)) {
        if (p.startsWith('..') || p.startsWith('/')) warnings.push(`${a.rel} section "${s.title}" has scope "${p}" outside its own directory — put that rule in a BOUNDS.md that covers it`);
      }
    }
  }
  return [...new Set(warnings)];
}
