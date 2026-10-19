import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, isGlossary } from './parse.mjs';
import { isFormatted, specVersion, SPEC_VERSION } from './format.mjs';

export { parse, parseTerm, isGlossary, LEVELS } from './parse.mjs';
export { format, sameContent, contentHash } from './format.mjs';

// Words that make a rule uncheckable: nobody can look at a diff and say whether it was followed.
const VAGUE = /\b(properly|proper|good|clean|nice|appropriate|best practices?|when needed|if possible|as needed)\b|хорош|правильн|красив|аккуратн|по возможности|при необходимости|когда нужно/i;

// Advisory thresholds only: they produce recommendations, never block anything.
export const ADVICE = { ruleChars: 200, tokens: 3000 };

export function findBoundsMd(dir) {
  try {
    const name = fs.readdirSync(dir).find((f) => f.toLowerCase() === 'bounds.md');
    return name ? path.join(dir, name) : null;
  } catch {
    return null;
  }
}

export function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

export function check(text) {
  const { sections, problems } = parse(text);
  if (!isFormatted(text)) {
    const v = specVersion(text);
    problems.push({
      kind: 'layout',
      line: 0,
      msg: v === null || v === SPEC_VERSION ? 'layout differs from the standard — /bounds:doctor can fix it' : `file uses format v${v}, current is v${SPEC_VERSION} — /bounds:doctor can migrate it`,
    });
  }
  const seen = new Map();
  for (const s of sections) {
    if (s.rules.length && !s.owner) problems.push({ kind: 'owner', line: s.line, msg: `section "${s.title}" has rules but no owner` });
    for (const r of s.rules) {
      if (!r.id) problems.push({ kind: 'id', line: r.line, msg: `rule has no ID — others can't refer to it` });
      else if (seen.has(r.id)) problems.push({ kind: 'dup', line: r.line, msg: `duplicate ID ${r.id} (first at line ${seen.get(r.id)})` });
      else seen.set(r.id, r.line);
      const vague = r.text.match(VAGUE);
      if (vague) problems.push({ kind: 'vague', line: r.line, msg: `${r.id ?? 'rule'}: vague word "${vague[0]}" — can't be checked against a diff` });
      if (r.text.length > ADVICE.ruleChars) problems.push({ kind: 'long', line: r.line, msg: `${r.id ?? 'rule'}: ${r.text.length} chars — probably more than one boundary` });
    }
  }
  const terms = sections.flatMap((s) => s.terms);
  for (const s of sections.filter(isGlossary)) {
    if (s.terms.length && !s.owner) problems.push({ kind: 'owner', line: s.line, msg: `section "${s.title}" has terms but no owner` });
  }
  const names = new Map();
  for (const t of terms) {
    if (!t.meaning && t.names.length < 2) problems.push({ kind: 'term', line: t.line, msg: `term "${t.names[0] ?? ''}" has no meaning — add "— what it means"` });
    for (const n of t.names) {
      const key = n.toLowerCase();
      if (names.has(key)) problems.push({ kind: 'dup-term', line: t.line, msg: `term "${n}" is defined twice (first at line ${names.get(key)})` });
      else names.set(key, t.line);
    }
  }
  for (const t of terms) {
    for (const a of t.avoid) {
      if (names.has(a.toLowerCase())) problems.push({ kind: 'term-conflict', line: t.line, msg: `"${a}" is both a term (line ${names.get(a.toLowerCase())}) and a word to avoid` });
    }
  }
  const tokens = estimateTokens(text);
  if (tokens > ADVICE.tokens) problems.push({ kind: 'size', line: 0, msg: `file is ~${tokens} tokens and is loaded into every session — look for rules to merge or drop` });
  problems.sort((a, b) => a.line - b.line);
  const ruleCount = sections.reduce((n, s) => n + s.rules.length, 0);
  return { sections, problems, ruleCount, terms };
}

// Splits camelCase, snake_case and kebab-case so that "categoryId" counts as using "category".
function words(text) {
  const tokens = text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return ` ${tokens.join(' ')} `;
}

// Avoided glossary words that appear in `added` but were not already in `removed`.
export function findAvoided(added, removed, terms) {
  const now = words(added);
  const before = words(removed || '');
  const hits = [];
  for (const t of terms) {
    for (const a of t.avoid) {
      const needle = words(a);
      if (needle.trim() && now.includes(needle) && !before.includes(needle)) hits.push({ word: a, use: t.names.join(' / ') });
    }
  }
  return hits;
}

// --- protection -------------------------------------------------------------

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READONLY_CMDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'rg', 'wc', 'diff', 'stat', 'file', 'ls', 'bat', 'md5sum', 'sha256sum']);
const READONLY_GIT = new Set(['diff', 'log', 'blame', 'show', 'status']);

export const DENY_REASON =
  'BOUNDS.md content is written by humans only (bounds plugin). Do not change, move, delete or recreate it by any means. ' +
  'To fix its layout, use /bounds:doctor — the only thing allowed to rewrite it, and only its layout. ' +
  'If a rule should change, tell the user and give the exact line(s) to paste.';

export function isBoundsPath(p) {
  return typeof p === 'string' && path.basename(p).toLowerCase() === 'bounds.md';
}

// Returns a deny reason, or null when the tool call may proceed.
export function guard(toolName, input = {}, cwd = process.cwd()) {
  if (EDIT_TOOLS.has(toolName)) {
    const target = input.file_path || input.notebook_path;
    if (!isBoundsPath(target)) return null;
    // Creating the file from scratch (e.g. /bounds:init) is allowed; changing an existing one is not.
    if (toolName === 'Write' && !fs.existsSync(path.resolve(cwd, target))) return null;
    return DENY_REASON;
  }
  if (toolName === 'Bash') return bashTouchesBoundsMd(input.command || '') ? DENY_REASON : null;
  return null;
}

// Allow-list: a shell segment that mentions BOUNDS.md must be a known read-only command without redirects.
export function bashTouchesBoundsMd(command) {
  if (!/bounds\.md/i.test(command)) return false;
  const segments = command.split(/&&|\|\||;|\||\n/);
  return segments.some((seg) => {
    if (!/bounds\.md/i.test(seg)) return false;
    const cleaned = seg.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, '');
    if (/>/.test(cleaned)) return true;
    const words = cleaned.trim().split(/\s+/).filter((w) => !/^\w+=/.test(w) && w !== 'sudo' && w !== 'command');
    const [cmd, sub] = words;
    const name = path.basename(cmd || '');
    if (READONLY_CMDS.has(name)) return false;
    if (name === 'git' && READONLY_GIT.has(sub)) return false;
    if (name === 'sed' && !/\s(-i|--in-place)/.test(cleaned)) return false;
    return true;
  });
}

// --- state ------------------------------------------------------------------

export function stateFile(projectDir) {
  const base = process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'bounds-md');
  return path.join(base, `${hash(path.resolve(projectDir))}.json`);
}

export function loadState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { reviewed: null, hinted: false, sessions: {} };
  }
}

export function saveState(file, state) {
  const ids = Object.keys(state.sessions);
  // Keep the file small: remember only the most recent sessions.
  for (const id of ids.sort((a, b) => state.sessions[a].at - state.sessions[b].at).slice(0, Math.max(0, ids.length - 50))) {
    delete state.sessions[id];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
