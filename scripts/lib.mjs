import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const LEVELS = ['NEVER', 'MUST NOT', 'MUST', 'SHOULD NOT', 'SHOULD'];

const RULE_RE = new RegExp(`^- (?:\\[?([A-Z][A-Z0-9_]*-\\d+)\\]?\\s+)?(${LEVELS.join('|')})\\b:?\\s*(.+)$`);

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

export function parse(text) {
  const sections = [];
  const problems = [];
  let section = null;
  let rule = null;
  let inComment = false;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.trimStart().startsWith('<!--')) {
      inComment = !line.includes('-->');
      continue;
    }

    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = { title: heading[1], owner: null, scope: null, rules: [], line: lineNo };
      sections.push(section);
      rule = null;
      continue;
    }
    if (!section) continue;

    const meta = line.match(/^(owner|scope)\s*:\s*(.*)$/i);
    if (meta) {
      section[meta[1].toLowerCase()] = meta[2].trim() || null;
      continue;
    }

    if (line.startsWith('- ')) {
      const m = line.match(RULE_RE);
      if (m) {
        rule = { id: m[1] || null, level: m[2], text: m[3].trim(), line: lineNo, section: section.title };
        section.rules.push(rule);
      } else {
        rule = null;
        problems.push({ kind: 'format', line: lineNo, msg: `list item without a level (${LEVELS.join('/')}): "${line.slice(2, 70)}"` });
      }
    } else if (rule && /^\s+\S/.test(line)) {
      rule.text += ' ' + line.trim();
    } else if (line.trim() === '') {
      rule = null;
    }
  }
  return { sections, problems };
}

export function lint(text) {
  const { sections, problems } = parse(text);
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
  const tokens = estimateTokens(text);
  if (tokens > ADVICE.tokens) problems.push({ kind: 'size', line: 0, msg: `file is ~${tokens} tokens and is loaded into every session — look for rules to merge or drop` });
  problems.sort((a, b) => a.line - b.line);
  const ruleCount = sections.reduce((n, s) => n + s.rules.length, 0);
  return { sections, problems, ruleCount };
}

// --- protection -------------------------------------------------------------

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READONLY_CMDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'rg', 'wc', 'diff', 'stat', 'file', 'ls', 'bat', 'md5sum', 'sha256sum']);
const READONLY_GIT = new Set(['diff', 'log', 'blame', 'show', 'status']);

export const DENY_REASON =
  'BOUNDS.md is written by humans only (bounds plugin). Do not change, move, delete or recreate it by any means. ' +
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
