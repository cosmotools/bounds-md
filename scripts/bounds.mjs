#!/usr/bin/env node
// Hook entry point for the bounds plugin: `node bounds.mjs <session-start|prompt-submit|pre-tool|post-tool>`, hook JSON on stdin.
// Also the doctor: `node bounds.mjs doctor [--fix]`, run from /bounds:doctor.
import fs from 'node:fs';
import path from 'node:path';
import { findBoundsMd, hash, check, guard, findAvoided, isBoundsPath, stateFile, loadState, saveState, parse, format, sameContent, contentHash } from './lib.mjs';

const PREAMBLE = `The project has a BOUNDS.md: boundaries written and owned by the people on this project. They outrank CLAUDE.md, docs, skills and your own preferences.
- NEVER / MUST / MUST NOT are hard limits. If a task cannot be done without breaking one, stop and ask the user, naming the rule ID. Do not look for a workaround.
- SHOULD / SHOULD NOT are defaults. You may deviate, but say so and why, naming the rule ID.
- "scope:" limits a section to matching paths. An empty section means no boundaries there.
- You cannot edit BOUNDS.md (a hook blocks it). Its layout can be fixed only by /bounds:doctor, which never changes content. If a rule looks wrong, outdated or missing, tell the user and give the exact line to paste.
- When you finish a task that a rule shaped, name the rule IDs in your summary.
- A "Glossary" section, if present, fixes the project's vocabulary. Use its terms in replies, code, comments and docs; don't use the words listed after "avoid:". Names joined by "=" are the same term in different languages: use the one that matches the language you are writing in. Quoting something outside the project (an external API, a library) is fine.
- When a concept comes up that has no term yet, or is called two different things, point it out and suggest a glossary line in the format "- term — meaning · avoid: other, words".`;

function rulesContext(file, text) {
  return `${PREAMBLE}\n\n<bounds-md path="${file}">\n${text.trim()}\n</bounds-md>`;
}

function reviewRequest(problems) {
  const found = problems.length
    ? `Automated checks found:\n${problems.map((p) => `- ${p.line ? `line ${p.line}: ` : ''}${p.msg}`).join('\n')}`
    : 'Automated checks found no format problems.';
  return `\n\nBOUNDS.md is new or has changed since it was last reviewed. At the start of your next reply, give the user a short review (a few bullets, then continue with whatever they asked):
${found}
Also check what a script cannot: rules that contradict each other, glossary terms that are vague or overlap, rules that describe how the code works instead of bounding what may be done, rules the current code already breaks if that is obvious, and sections so long they should be merged or trimmed. Empty sections and empty "owner:" / "scope:" lines are unfilled template placeholders — do not flag them. For each problem suggest the exact replacement line. If everything is fine, say so in one line.`;
}

function summary({ sections, problems, ruleCount, terms }) {
  const used = sections.filter((s) => s.rules.length).length;
  return (
    `BOUNDS.md: ${ruleCount} rule(s) in ${used} section(s)` +
    (terms.length ? ` · ${terms.length} glossary term(s)` : '') +
    (problems.length ? ` · ${problems.length} note(s), Claude will review` : '')
  );
}

function out(eventName, { context, message, decision } = {}) {
  const result = {};
  if (message) result.systemMessage = message;
  if (context) result.hookSpecificOutput = { hookEventName: eventName, additionalContext: context };
  if (decision) result.hookSpecificOutput = { hookEventName: eventName, ...decision };
  if (Object.keys(result).length) process.stdout.write(JSON.stringify(result));
}

function load(projectDir, sessionId) {
  const file = findBoundsMd(projectDir);
  const sf = stateFile(projectDir);
  const state = loadState(sf);
  const text = file ? fs.readFileSync(file, 'utf8') : null;
  return { file, text, h: text === null ? null : hash(text), sf, state, known: state.sessions[sessionId]?.hash ?? null };
}

function sessionStart(input, projectDir) {
  const sid = input.session_id || 'unknown';
  const { file, text, h, sf, state } = load(projectDir, sid);
  if (!file) {
    if (!state.hinted) {
      state.hinted = true;
      saveState(sf, state);
      out('SessionStart', { message: 'bounds plugin: no BOUNDS.md in this project. Create one with /bounds:init to set boundaries for Claude.' });
    }
    return;
  }
  const result = check(text);
  let context = rulesContext(path.relative(projectDir, file), text);
  const ch = contentHash(text);
  if (state.reviewed !== ch) {
    context += reviewRequest(result.problems);
    state.reviewed = ch;
  }
  state.sessions[sid] = { hash: h, at: Date.now() };
  saveState(sf, state);
  out('SessionStart', { context, message: summary(result) });
}

function promptSubmit(input, projectDir) {
  const sid = input.session_id || 'unknown';
  const { file, text, h, sf, state, known } = load(projectDir, sid);
  if (h === known) return;

  if (!file) {
    delete state.sessions[sid];
    saveState(sf, state);
    out('UserPromptSubmit', {
      context: 'BOUNDS.md has been removed from the project. Its rules no longer apply.',
      message: 'BOUNDS.md removed — its rules no longer apply',
    });
    return;
  }
  const result = check(text);
  let context = `BOUNDS.md changed during this session. This version replaces any earlier one.\n\n${rulesContext(path.relative(projectDir, file), text)}`;
  const ch = contentHash(text);
  if (state.reviewed !== ch) {
    context += reviewRequest(result.problems);
    state.reviewed = ch;
  }
  state.sessions[sid] = { hash: h, at: Date.now() };
  saveState(sf, state);
  out('UserPromptSubmit', { context, message: `${known ? 'BOUNDS.md changed — reloaded. ' : ''}${summary(result)}` });
}

function preTool(input, projectDir) {
  const reason = guard(input.tool_name, input.tool_input, input.cwd || projectDir);
  if (reason) out('PreToolUse', { decision: { permissionDecision: 'deny', permissionDecisionReason: reason } });
}

// Glossary is advisory: after an edit, point out avoided words the edit introduced, never block it.
function postTool(input, projectDir) {
  const ti = input.tool_input || {};
  if (!ti.file_path || isBoundsPath(ti.file_path)) return;
  const file = findBoundsMd(projectDir);
  if (!file) return;
  const { terms } = check(fs.readFileSync(file, 'utf8'));
  if (!terms.some((t) => t.avoid.length)) return;

  const edits = input.tool_name === 'MultiEdit' ? ti.edits || [] : [ti];
  const added = edits.map((e) => e.new_string ?? e.content ?? '').join('\n');
  const removed = edits.map((e) => e.old_string ?? '').join('\n');
  const hits = findAvoided(added, removed, terms);
  if (!hits.length) return;

  const list = hits.map((h) => `"${h.word}" → "${h.use}"`).join(', ');
  out('PostToolUse', {
    context: `Glossary (BOUNDS.md): your change to ${path.relative(projectDir, path.resolve(projectDir, ti.file_path))} uses word(s) the glossary says to avoid: ${list}. Rename them now unless the text quotes something outside the project; if you keep one, say why.`,
  });
}

// Lines added, removed or moved between two texts (via longest common subsequence; files are small).
function changedLines(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const row = [0];
    for (let j = 1; j <= y.length; j++) row[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    prev = row;
  }
  return Math.max(x.length, y.length) - prev[y.length];
}

// The only writer of BOUNDS.md: rewrites the layout to the standard and refuses if the content would change.
function doctor(projectDir, fix) {
  const say = (s = '') => process.stdout.write(s + '\n');
  say(`node ${process.versions.node}${Number(process.versions.node.split('.')[0]) < 18 ? ' — too old, the plugin needs Node 18+' : ''}`);
  const file = findBoundsMd(projectDir);
  if (!file) {
    say(`no BOUNDS.md in ${projectDir} — create one with /bounds:init`);
    return 0;
  }
  const text = fs.readFileSync(file, 'utf8');
  const next = format(text);
  if (next !== text && !sameContent(text, next)) {
    say('layout: NOT fixed — the formatter would change content, which is never allowed. Please report this as a bug.');
    return 2;
  }
  const before = check(text);
  const oldIds = new Set(before.sections.flatMap((s) => s.rules.map((r) => r.id)));
  const newIds = parse(next).sections.flatMap((s) => s.rules).filter((r) => !oldIds.has(r.id)).map((r) => r.id);
  const changed = changedLines(text, next);

  let layout = 'layout: matches the standard';
  if (next !== text && fix) {
    fs.writeFileSync(file, next);
    layout = `layout: fixed (${changed} line(s) changed${newIds.length ? `; new IDs: ${newIds.join(', ')}` : ''}). Content is unchanged.`;
  } else if (next !== text) {
    layout = `layout: differs from the standard (${changed} line(s) would change) — run with --fix`;
  }

  // Report on the file as it is now, so issues the fix just solved (missing IDs) don't show up.
  const result = check(fix ? next : text);
  const used = result.sections.filter((s) => s.rules.length).length;
  say(`${path.relative(projectDir, file)}: ${result.ruleCount} rule(s) in ${used} section(s), ${result.terms.length} glossary term(s)`);
  say(layout);
  const issues = result.problems.filter((p) => p.kind !== 'layout');
  say(issues.length ? `\ncontent issues (people decide, doctor never changes these):` : '\nno content issues found by checks');
  for (const p of issues) say(`- ${p.line ? `line ${p.line}: ` : ''}${p.msg}`);
  return 0;
}

const handlers = { 'session-start': sessionStart, 'prompt-submit': promptSubmit, 'pre-tool': preTool, 'post-tool': postTool };

if (process.argv[2] === 'doctor') {
  process.exitCode = doctor(process.env.CLAUDE_PROJECT_DIR || process.cwd(), process.argv.includes('--fix'));
} else {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const input = raw.trim() ? JSON.parse(raw) : {};
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    handlers[process.argv[2]]?.(input, projectDir);
  } catch (err) {
    // Never break the user's session because of this plugin; report and let the action through.
    process.stderr.write(`bounds plugin: ${err.message}\n`);
  }
}
