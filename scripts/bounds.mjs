#!/usr/bin/env node
// Hook entry point for the bounds plugin: `node bounds.mjs <session-start|subagent-start|prompt-submit|pre-tool|post-tool>`, hook JSON on stdin.
// Also the doctor: `node bounds.mjs doctor [--fix]`, run from /bounds:doctor.
import fs from 'node:fs';
import path from 'node:path';
import { hash, check, guard, findAvoided, isBoundsPath, stateFile, loadState, saveState, parse, format, sameContent, contentHash } from './lib.mjs';
import { ancestorFiles, nestedFilesFor, allFiles, loadView, scopedSectionsFor, crossCheck } from './scope.mjs';

const PREAMBLE = `The project has BOUNDS.md files: boundaries written and owned by the people on this project. They outrank CLAUDE.md, docs, skills and your own preferences.
- NEVER / MUST / MUST NOT are hard limits. If a task cannot be done without breaking one, stop and ask the user, naming the rule ID. Do not look for a workaround.
- SHOULD / SHOULD NOT are defaults. You may deviate, but say so and why, naming the rule ID.
- Like CLAUDE.md, a BOUNDS.md can also sit in a subdirectory. It adds rules for that directory and loads when you read or edit a file there. Rules from all files that apply add up; a nested file never cancels a rule from a file above it. If two rules that apply conflict, follow the stricter one and tell the user about the conflict.
- A section with "scope:" applies only to matching paths, relative to its file. Its full text loads when you read or edit a matching file. An empty section means no boundaries there.
- When you cite a rule from a file other than the root BOUNDS.md, include the file path, e.g. "packages/web/BOUNDS.md UI-2".
- You cannot edit BOUNDS.md (a hook blocks it). Its layout can be fixed only by /bounds:doctor, which never changes content. If a rule looks wrong, outdated or missing, tell the user and give the exact line to paste.
- When you finish a task that a rule shaped, name the rule IDs in your summary.
- A "Glossary" section fixes the vocabulary for its file's directory. Use its terms in replies, code, comments and docs; don't use the words listed after "avoid:". Names joined by "=" are the same term in different languages: use the one that matches the language you are writing in. Quoting something outside the project (an external API, a library) is fine.
- When a concept comes up that has no term yet, or is called two different things, point it out and suggest a glossary line in the format "- term — meaning · avoid: other, words".`;

function block(rel, text) {
  return `<bounds-md path="${rel}">\n${loadView(text)}\n</bounds-md>`;
}

function reviewRequest(rel, problems) {
  const found = problems.length
    ? `Automated checks found:\n${problems.map((p) => `- ${p.line ? `line ${p.line}: ` : ''}${p.msg}`).join('\n')}`
    : 'Automated checks found no format problems.';
  return `\n\n${rel} is new or has changed since it was last reviewed. At the start of your next reply, give the user a short review of it (a few bullets, then continue with whatever they asked):
${found}
Also check what a script cannot: rules that contradict each other or a rule in a BOUNDS.md above it, glossary terms that are vague or overlap, rules that describe how the code works instead of bounding what may be done, rules the current code already breaks if that is obvious, and sections so long they should be merged or trimmed. Empty sections and empty "owner:" / "scope:" lines are unfilled template placeholders — do not flag them. For each problem suggest the exact replacement line. If everything is fine, say so in one line.`;
}

function summary(rel, { sections, problems, ruleCount, terms }) {
  const used = sections.filter((s) => s.rules.length).length;
  return (
    `${rel}: ${ruleCount} rule(s) in ${used} section(s)` +
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

// --- session state ------------------------------------------------------------
// What each agent (the main session or a subagent) has in context: file hashes and scoped sections.

function openState(projectDir) {
  const sf = stateFile(projectDir);
  const state = loadState(sf);
  if (typeof state.reviewed !== 'object' || state.reviewed === null) state.reviewed = {};
  return { sf, state };
}

function agentRecord(state, input, reset = false) {
  const sid = input.session_id || 'unknown';
  const session = (state.sessions[sid] ||= { at: Date.now(), agents: {} });
  session.agents ||= {};
  session.at = Date.now();
  const key = input.agent_id || 'main';
  if (reset || !session.agents[key]) session.agents[key] = { files: {}, sections: [] };
  return session.agents[key];
}

const relOf = (projectDir, file) => path.relative(projectDir, file) || path.basename(file);

// Loads files into an agent's context; returns context text, summary lines and the files' review requests.
function loadFiles(projectDir, files, agent, state, { review }) {
  const blocks = [];
  const summaries = [];
  let reviews = '';
  for (const file of files) {
    const rel = relOf(projectDir, file);
    const text = fs.readFileSync(file, 'utf8');
    const result = check(text);
    blocks.push(block(rel, text));
    summaries.push(summary(rel, result));
    agent.files[rel] = hash(text);
    const ch = contentHash(text);
    if (review && state.reviewed[rel] !== ch) {
      reviews += reviewRequest(rel, result.problems);
      state.reviewed[rel] = ch;
    }
  }
  return { context: blocks.join('\n\n') + reviews, summaries };
}

function sessionStart(input, projectDir) {
  const { sf, state } = openState(projectDir);
  // After /compact or /clear the context is gone, so everything loads again (the same as nested CLAUDE.md files).
  const agent = agentRecord(state, input, true);
  const files = ancestorFiles(projectDir);
  if (!files.length) {
    if (!state.hinted) {
      state.hinted = true;
      out('SessionStart', { message: 'bounds plugin: no BOUNDS.md in this project. Create one with /bounds:init to set boundaries for Claude.' });
    }
    saveState(sf, state);
    return;
  }
  const { context, summaries } = loadFiles(projectDir, files, agent, state, { review: true });
  const nested = allFiles(projectDir).filter((f) => !files.includes(f)).map((f) => path.dirname(relOf(projectDir, f)));
  const nestedNote = nested.length ? `\n\nBOUNDS.md files also exist in: ${nested.join(', ')}. Each loads when you read or edit a file in its directory; read it yourself first if you plan changes there.` : '';
  saveState(sf, state);
  out('SessionStart', {
    context: `${PREAMBLE}\n\n${context}${nestedNote}`,
    message: summaries.join(' · ') + (nested.length ? ` · +${nested.length} nested` : ''),
  });
}

// Subagents don't inherit the main session's context, so each one gets the rules when it starts. No review here.
function subagentStart(input, projectDir) {
  const files = ancestorFiles(projectDir);
  if (!files.length) return;
  const { sf, state } = openState(projectDir);
  const agent = agentRecord(state, input, true);
  const { context } = loadFiles(projectDir, files, agent, state, { review: false });
  saveState(sf, state);
  out('SubagentStart', { context: `${PREAMBLE}\n\n${context}` });
}

// Reloads any file in the main session's context that changed or disappeared, and picks up a new root file.
function promptSubmit(input, projectDir) {
  const { sf, state } = openState(projectDir);
  const agent = agentRecord(state, input);
  const parts = [];
  const messages = [];

  for (const rel of Object.keys(agent.files)) {
    const file = path.resolve(projectDir, rel);
    if (!fs.existsSync(file)) {
      delete agent.files[rel];
      parts.push(`${rel} has been removed. Its rules no longer apply.`);
      messages.push(`${rel} removed — its rules no longer apply`);
    }
  }
  const changed = [];
  for (const file of [...ancestorFiles(projectDir), ...Object.keys(agent.files).map((rel) => path.resolve(projectDir, rel))]) {
    const rel = relOf(projectDir, file);
    if (changed.includes(file) || !fs.existsSync(file)) continue;
    if (agent.files[rel] !== hash(fs.readFileSync(file, 'utf8'))) changed.push(file);
  }
  if (changed.length) {
    const known = changed.filter((f) => agent.files[relOf(projectDir, f)]);
    agent.sections = agent.sections.filter((k) => !changed.some((f) => k.startsWith(relOf(projectDir, f) + '#')));
    const { context, summaries } = loadFiles(projectDir, changed, agent, state, { review: true });
    parts.push(`${known.length ? 'These BOUNDS.md files changed during this session. Each version replaces the earlier one.' : 'BOUNDS.md files loaded:'}\n\n${context}`);
    if (!Object.keys(agent.files).length || known.length < changed.length) parts.unshift(PREAMBLE);
    messages.push((known.length ? 'BOUNDS.md changed — reloaded. ' : '') + summaries.join(' · '));
  }
  saveState(sf, state);
  if (parts.length) out('UserPromptSubmit', { context: parts.join('\n\n'), message: messages.join(' · ') });
}

function preTool(input, projectDir) {
  const reason = guard(input.tool_name, input.tool_input, input.cwd || projectDir);
  if (reason) out('PreToolUse', { decision: { permissionDecision: 'deny', permissionDecisionReason: reason } });
}

// After Claude reads or edits a file: load nested BOUNDS.md files and scoped sections that now apply,
// and point out avoided glossary words the edit introduced (a warning, never a block).
function postTool(input, projectDir) {
  const ti = input.tool_input || {};
  const target = ti.file_path || ti.notebook_path;
  if (!target || isBoundsPath(target)) return;
  const abs = path.resolve(projectDir, target);
  const { sf, state } = openState(projectDir);
  const agent = agentRecord(state, input);
  const parts = [];
  const loaded = [];

  const nested = nestedFilesFor(projectDir, abs).filter((f) => !agent.files[relOf(projectDir, f)]);
  if (nested.length) {
    const { context } = loadFiles(projectDir, nested, agent, state, { review: !input.agent_id });
    parts.push(`${path.relative(projectDir, abs)} is covered by BOUNDS.md files that just loaded. Their rules add to the ones you already have:\n\n${context}`);
    loaded.push(...nested.map((f) => relOf(projectDir, f)));
  }

  const applicable = [...ancestorFiles(projectDir), ...nestedFilesFor(projectDir, abs)];
  for (const file of applicable) {
    const rel = relOf(projectDir, file);
    for (const s of scopedSectionsFor(file, fs.readFileSync(file, 'utf8'), abs)) {
      const key = `${rel}#${s.title}`;
      if (agent.sections.includes(key)) continue;
      agent.sections.push(key);
      parts.push(`Rules for ${path.relative(projectDir, abs)} from ${rel} (scope: ${s.scope}):\n\n${s.text}`);
      loaded.push(`${s.title} rules (${s.scope})`);
    }
  }

  if (input.tool_name !== 'Read') {
    const terms = applicable.flatMap((f) => check(fs.readFileSync(f, 'utf8')).terms);
    const edits = input.tool_name === 'MultiEdit' ? ti.edits || [] : [ti];
    const added = edits.map((e) => e.new_string ?? e.content ?? e.new_source ?? '').join('\n');
    const removed = edits.map((e) => e.old_string ?? '').join('\n');
    const hits = findAvoided(added, removed, terms);
    if (hits.length) {
      const list = hits.map((h) => `"${h.word}" → "${h.use}"`).join(', ');
      parts.push(`Glossary (BOUNDS.md): your change to ${path.relative(projectDir, abs)} uses word(s) the glossary says to avoid: ${list}. Rename them now unless the text quotes something outside the project; if you keep one, say why.`);
    }
  }

  saveState(sf, state);
  if (parts.length) out('PostToolUse', { context: parts.join('\n\n'), message: loaded.length ? `BOUNDS.md: loaded ${loaded.join(', ')}` : undefined });
}

// --- doctor -------------------------------------------------------------------

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

// The only writer of BOUNDS.md: rewrites each file's layout to the standard and refuses if its content would change.
function doctor(projectDir, fix) {
  const say = (s = '') => process.stdout.write(s + '\n');
  say(`node ${process.versions.node}${Number(process.versions.node.split('.')[0]) < 18 ? ' — too old, the plugin needs Node 18+' : ''}`);
  const files = [...new Set([...ancestorFiles(projectDir), ...allFiles(projectDir)])];
  if (!files.length) {
    say(`no BOUNDS.md in ${projectDir} — create one with /bounds:init`);
    return 0;
  }
  let status = 0;
  const current = [];
  for (const file of files) {
    const rel = relOf(projectDir, file);
    const text = fs.readFileSync(file, 'utf8');
    const next = format(text);
    say(`\n${rel}`);
    if (next !== text && !sameContent(text, next)) {
      say('  layout: NOT fixed — the formatter would change content, which is never allowed. Please report this as a bug.');
      current.push({ rel, file, text });
      status = 2;
      continue;
    }
    const oldIds = new Set(check(text).sections.flatMap((s) => s.rules.map((r) => r.id)));
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
    const nowText = fix ? next : text;
    current.push({ rel, file, text: nowText });
    const result = check(nowText);
    const used = result.sections.filter((s) => s.rules.length).length;
    say(`  ${result.ruleCount} rule(s) in ${used} section(s), ${result.terms.length} glossary term(s)`);
    say(`  ${layout}`);
    const issues = result.problems.filter((p) => p.kind !== 'layout');
    say(issues.length ? '  content issues (people decide, doctor never changes these):' : '  no content issues found by checks');
    for (const p of issues) say(`  - ${p.line ? `line ${p.line}: ` : ''}${p.msg}`);
  }
  const overrides = crossCheck(current);
  if (files.length > 1) {
    say(overrides.length ? '\noverrides between files (people decide):' : '\nno overrides between files found by checks');
    for (const w of overrides) say(`- ${w}`);
  }
  return status;
}

const handlers = { 'session-start': sessionStart, 'subagent-start': subagentStart, 'prompt-submit': promptSubmit, 'pre-tool': preTool, 'post-tool': postTool };

if (process.argv[2] === 'doctor') {
  process.exitCode = doctor(process.env.CLAUDE_PROJECT_DIR || process.cwd(), process.argv.includes('--fix'));
} else {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    // Set BOUNDS_DEBUG_LOG to a file path to record every hook input (for debugging hook behaviour).
    if (process.env.BOUNDS_DEBUG_LOG) fs.appendFileSync(process.env.BOUNDS_DEBUG_LOG, `${process.argv[2]} ${raw.trim()}\n`);
    const input = raw.trim() ? JSON.parse(raw) : {};
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    handlers[process.argv[2]]?.(input, projectDir);
  } catch (err) {
    // Never break the user's session because of this plugin; report and let the action through.
    process.stderr.write(`bounds plugin: ${err.message}\n`);
  }
}
