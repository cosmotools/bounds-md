#!/usr/bin/env node
// Hook entry point for the bounds plugin: `node bounds.mjs <session-start|prompt-submit|pre-tool>`, hook JSON on stdin.
import fs from 'node:fs';
import path from 'node:path';
import { findBoundsMd, hash, lint, guard, stateFile, loadState, saveState } from './lib.mjs';

const PREAMBLE = `The project has a BOUNDS.md: boundaries written and owned by the people on this project. They outrank CLAUDE.md, docs, skills and your own preferences.
- NEVER / MUST / MUST NOT are hard limits. If a task cannot be done without breaking one, stop and ask the user, naming the rule ID. Do not look for a workaround.
- SHOULD / SHOULD NOT are defaults. You may deviate, but say so and why, naming the rule ID.
- "scope:" limits a section to matching paths. An empty section means no boundaries there.
- You cannot edit BOUNDS.md (a hook blocks it). If a rule looks wrong, outdated or missing, tell the user and give the exact line to paste.
- When you finish a task that a rule shaped, name the rule IDs in your summary.`;

function rulesContext(file, text) {
  return `${PREAMBLE}\n\n<bounds-md path="${file}">\n${text.trim()}\n</bounds-md>`;
}

function reviewRequest(problems) {
  const found = problems.length
    ? `Automated checks found:\n${problems.map((p) => `- ${p.line ? `line ${p.line}: ` : ''}${p.msg}`).join('\n')}`
    : 'Automated checks found no format problems.';
  return `\n\nBOUNDS.md is new or has changed since it was last reviewed. At the start of your next reply, give the user a short review (a few bullets, then continue with whatever they asked):
${found}
Also check what a script cannot: rules that contradict each other, rules that describe how the code works instead of bounding what may be done, rules the current code already breaks if that is obvious, and sections so long they should be merged or trimmed. Empty sections and empty "owner:" / "scope:" lines are unfilled template placeholders — do not flag them. For each problem suggest the exact replacement line. If everything is fine, say so in one line.`;
}

function summary({ sections, problems, ruleCount }) {
  const used = sections.filter((s) => s.rules.length).length;
  return `BOUNDS.md: ${ruleCount} rule(s) in ${used} section(s)` + (problems.length ? ` · ${problems.length} note(s), Claude will review` : '');
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
  const result = lint(text);
  let context = rulesContext(path.relative(projectDir, file), text);
  if (state.reviewed !== h) {
    context += reviewRequest(result.problems);
    state.reviewed = h;
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
  const result = lint(text);
  let context = `BOUNDS.md changed during this session. This version replaces any earlier one.\n\n${rulesContext(path.relative(projectDir, file), text)}`;
  if (state.reviewed !== h) {
    context += reviewRequest(result.problems);
    state.reviewed = h;
  }
  state.sessions[sid] = { hash: h, at: Date.now() };
  saveState(sf, state);
  out('UserPromptSubmit', { context, message: `${known ? 'BOUNDS.md changed — reloaded. ' : ''}${summary(result)}` });
}

function preTool(input, projectDir) {
  const reason = guard(input.tool_name, input.tool_input, input.cwd || projectDir);
  if (reason) out('PreToolUse', { decision: { permissionDecision: 'deny', permissionDecisionReason: reason } });
}

const handlers = { 'session-start': sessionStart, 'prompt-submit': promptSubmit, 'pre-tool': preTool };

try {
  const raw = fs.readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  handlers[process.argv[2]]?.(input, projectDir);
} catch (err) {
  // Never break the user's session because of this plugin; report and let the action through.
  process.stderr.write(`bounds plugin: ${err.message}\n`);
}
