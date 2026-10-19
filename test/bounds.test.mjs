import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { check, guard, bashTouchesBoundsMd, findBoundsMd, parseTerm, findAvoided } from '../scripts/lib.mjs';

const HOOK = path.resolve('scripts/bounds.mjs');
const TEMPLATE = fs.readFileSync('skills/init/SKILL.md', 'utf8').match(/````markdown\n([\s\S]*?)````/)[1];

const SAMPLE = `# BOUNDS.md
<!-- - NEVER this is a comment, not a rule -->
## UI
owner: @anna
scope: src/ui/**
- UI-1 MUST build screens from src/ui/kit — one design system
- UI-2 NEVER add CSS frameworks
  or UI libraries
- [UI-3] SHOULD write clean components
- use good names

## Backend
- BACKEND-1 NEVER log personal data — GDPR
- UI-1 MUST NOT call the DB from handlers
- SHOULD keep handlers small
`;

test('parses sections, owners, scopes, rules and continuation lines; skips comments', () => {
  const { sections } = check(SAMPLE);
  assert.deepEqual(sections.map((s) => s.title), ['UI', 'Backend']);
  assert.equal(sections[0].owner, '@anna');
  assert.equal(sections[0].scope, 'src/ui/**');
  assert.deepEqual(sections[0].rules.map((r) => r.id), ['UI-1', 'UI-2', 'UI-3']);
  assert.equal(sections[0].rules[1].text, 'add CSS frameworks or UI libraries');
  assert.equal(sections[1].rules[1].level, 'MUST NOT');
  assert.equal(sections[1].rules[2].id, null);
});

test('checks report format, vague, owner, duplicate and missing-ID problems — and nothing about rule counts', () => {
  const kinds = check(SAMPLE).problems.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['dup', 'format', 'id', 'owner', 'vague']);
  const many = '## UI\nowner: a\n' + Array.from({ length: 40 }, (_, i) => `- UI-${i + 1} MUST rule ${i + 1}`).join('\n');
  assert.deepEqual(check(many).problems, []);
});

test('the empty template is clean', () => {
  const r = check(TEMPLATE);
  assert.equal(r.ruleCount, 0);
  assert.deepEqual(r.problems, []);
  assert.equal(r.sections.length, 10);
  assert.equal(r.terms.length, 0);
});

test('guard blocks edits to an existing BOUNDS.md, allows creating it and editing other files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-'));
  assert.equal(guard('Write', { file_path: path.join(dir, 'BOUNDS.md') }, dir), null);
  fs.writeFileSync(path.join(dir, 'BOUNDS.md'), '# x\n');
  assert.ok(guard('Write', { file_path: path.join(dir, 'BOUNDS.md') }, dir));
  assert.ok(guard('Edit', { file_path: 'BOUNDS.md' }, dir));
  assert.ok(guard('MultiEdit', { file_path: path.join(dir, 'sub', 'bounds.md') }, dir));
  assert.equal(guard('Edit', { file_path: path.join(dir, 'CLAUDE.md') }, dir), null);
  assert.equal(guard('Read', { file_path: path.join(dir, 'BOUNDS.md') }, dir), null);
});

test('bash guard: read-only commands pass, anything that could write is blocked', () => {
  for (const cmd of ['cat BOUNDS.md', 'grep -n NEVER BOUNDS.md', 'git diff BOUNDS.md', 'sed -n 1,5p BOUNDS.md', 'wc -l BOUNDS.md 2>/dev/null', 'cat BOUNDS.md | head', 'npm test']) {
    assert.equal(bashTouchesBoundsMd(cmd), false, cmd);
  }
  for (const cmd of ['echo x >> BOUNDS.md', "sed -i 's/a/b/' BOUNDS.md", 'echo x | tee -a BOUNDS.md', 'rm BOUNDS.md', 'mv BOUNDS.md old.md', 'python3 -c "open(\'BOUNDS.md\',\'w\')"', 'git checkout BOUNDS.md', 'cat x > bounds.md']) {
    assert.equal(bashTouchesBoundsMd(cmd), true, cmd);
  }
});

test('finds BOUNDS.md in any letter case', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-'));
  assert.equal(findBoundsMd(dir), null);
  fs.writeFileSync(path.join(dir, 'bounds.md'), '');
  assert.equal(findBoundsMd(dir), path.join(dir, 'bounds.md'));
});

test('hooks end to end: load, review once, reload on change, deny edits', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-proj-'));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-data-')) };
  const hook = (event, input) => {
    const outText = execFileSync('node', [HOOK, event], { input: JSON.stringify({ cwd: project, ...input }), env, encoding: 'utf8' });
    return outText ? JSON.parse(outText) : null;
  };

  // No file: a one-time hint, then silence.
  assert.match(hook('session-start', { session_id: 's1' }).systemMessage, /no BOUNDS\.md/);
  assert.equal(hook('session-start', { session_id: 's1' }), null);

  fs.writeFileSync(path.join(project, 'BOUNDS.md'), SAMPLE);
  const first = hook('session-start', { session_id: 's2' });
  assert.match(first.systemMessage, /6 rule\(s\) in 2 section\(s\) · 5 note\(s\)/);
  assert.match(first.hookSpecificOutput.additionalContext, /BACKEND-1 NEVER log personal data/);
  assert.match(first.hookSpecificOutput.additionalContext, /short review/);

  // Same content, new session: rules loaded, no second review.
  const second = hook('session-start', { session_id: 's3' });
  assert.doesNotMatch(second.hookSpecificOutput.additionalContext, /short review/);

  // Unchanged during the session: prompt hook stays silent.
  assert.equal(hook('prompt-submit', { session_id: 's3' }), null);

  // Human edits the file mid-session: reloaded and reviewed.
  fs.appendFileSync(path.join(project, 'BOUNDS.md'), '- BACKEND-2 MUST use repo.ts for DB access\n');
  const changed = hook('prompt-submit', { session_id: 's3' });
  assert.match(changed.systemMessage, /changed — reloaded/);
  assert.match(changed.hookSpecificOutput.additionalContext, /BACKEND-2 MUST use repo\.ts/);
  assert.match(changed.hookSpecificOutput.additionalContext, /short review/);

  const denied = hook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'sed -i s/NEVER/SHOULD/ BOUNDS.md' } });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hook('pre-tool', { tool_name: 'Edit', tool_input: { file_path: path.join(project, 'src/a.ts') } }), null);

  fs.rmSync(path.join(project, 'BOUNDS.md'));
  assert.match(hook('prompt-submit', { session_id: 's3' }).systemMessage, /removed/);
});

const GLOSSARY = `## Glossary
owner: @lead
- section — a group of rules for one area · avoid: category, group
- раздел = section-ru — same thing in Russian
- review — Claude's check of meaning
  avoid: audit
- orphan
- section — duplicate
- lint — script checks · avoid: review
- MUST this looks like a rule but is a term line
`;

test('parses glossary terms: names, translations, meaning, avoid lists, continuation lines', () => {
  assert.deepEqual(parseTerm('раздел = section — a group of rules · avoid: category, group'), {
    names: ['раздел', 'section'], meaning: 'a group of rules', avoid: ['category', 'group'],
  });
  assert.deepEqual(parseTerm('rule ID — e.g. UI-2'), { names: ['rule ID'], meaning: 'e.g. UI-2', avoid: [] });
  const { terms, ruleCount } = check(GLOSSARY);
  assert.equal(ruleCount, 0, 'glossary lines are never rules');
  assert.deepEqual(terms[2].avoid, ['audit']);
  assert.equal(terms[2].meaning, "Claude's check of meaning");
});

test('glossary checks: missing meaning, duplicate term, term that is also avoided; no level errors', () => {
  const kinds = check(GLOSSARY).problems.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['dup-term', 'term', 'term', 'term-conflict']); // "orphan" and the MUST line have no meaning
});

test('findAvoided matches whole words in prose and identifiers, ignores words already there', () => {
  const { terms } = check(GLOSSARY);
  assert.deepEqual(findAvoided('const categoryId = 1;', '', terms).map((h) => h.word), ['category']);
  assert.deepEqual(findAvoided('function getUserGroup() {}', '', terms).map((h) => h.word), ['group']);
  assert.deepEqual(findAvoided('Run an audit of rules', '', terms).map((h) => h.word), ['audit']);
  assert.deepEqual(findAvoided('categorical data, subgroups', '', terms), []);
  assert.deepEqual(findAvoided('the category list', 'the category list (old)', terms), []);
  const ru = check('## Глоссарий\nowner: x\n- раздел — группа правил · avoid: категория\n').terms;
  assert.deepEqual(findAvoided('Добавить категория в меню', '', ru).map((h) => h.word), ['категория']);
});

test('post-tool hook warns about avoided words in Claude edits and stays silent otherwise', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-proj-'));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-data-')) };
  const hook = (input) => {
    const outText = execFileSync('node', [HOOK, 'post-tool'], { input: JSON.stringify({ cwd: project, ...input }), env, encoding: 'utf8' });
    return outText ? JSON.parse(outText) : null;
  };
  const file = path.join(project, 'src/a.ts');
  assert.equal(hook({ tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'category' } }), null, 'no BOUNDS.md');
  fs.writeFileSync(path.join(project, 'BOUNDS.md'), GLOSSARY);
  const warn = hook({ tool_name: 'Edit', tool_input: { file_path: file, old_string: 'x', new_string: 'const categoryName = 1' } });
  assert.equal(warn.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(warn.hookSpecificOutput.additionalContext, /"category" → "section"/);
  assert.match(warn.hookSpecificOutput.additionalContext, /src\/a\.ts/);
  assert.equal(hook({ tool_name: 'Write', tool_input: { file_path: file, content: 'const sectionName = 1' } }), null);
  const multi = hook({ tool_name: 'MultiEdit', tool_input: { file_path: file, edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'run audit' }] } });
  assert.match(multi.hookSpecificOutput.additionalContext, /"audit" → "review"/);
});
