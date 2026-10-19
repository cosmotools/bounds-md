import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { check, guard, bashTouchesBoundsMd, findBoundsMd, parseTerm, findAvoided, format, sameContent, contentHash } from '../scripts/lib.mjs';

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
  assert.deepEqual(kinds, ['dup', 'format', 'id', 'layout', 'owner', 'vague']);
  const many = '## UI\nowner: a\n' + Array.from({ length: 40 }, (_, i) => `- UI-${i + 1} MUST rule ${i + 1}`).join('\n');
  assert.deepEqual(check(format(many)).problems, []);
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
  assert.match(first.systemMessage, /6 rule\(s\) in 2 section\(s\) · 6 note\(s\)/);
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

  // Subagents get the rules too, without a review request and without touching state.
  const sub = hook('subagent-start', { session_id: 's3', agent_type: 'general-purpose' });
  assert.equal(sub.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.match(sub.hookSpecificOutput.additionalContext, /BACKEND-2 MUST use repo\.ts/);
  assert.doesNotMatch(sub.hookSpecificOutput.additionalContext, /short review/);

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
  assert.deepEqual(kinds, ['dup-term', 'layout', 'term', 'term', 'term-conflict']); // "orphan" and the MUST line have no meaning
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

const MESSY = `# BOUNDS.md
<!-- team notes: ask @lead before adding sections -->

## testing
- [testing-2] must run tests before push
- never skip failing tests -- a red test is information
  even when the release is late

## Billing
owner: @kate
- BILL-1 NEVER store card numbers
- SHOULD round to cents - accountants
some prose note

## Glossary
owner: @lead
- section — group of rules · avoid: category
- buyer — a person who orders

## Product
owner: @pm
- PRODUCT-1 MUST stay free for students
`;

test('format puts the file in the standard layout and is idempotent', () => {
  const out = format(MESSY);
  assert.equal(format(out), out);
  const headings = out.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(headings, ['## Product', '## Testing', '## Billing', '## Glossary']);
  assert.match(out, /^# BOUNDS\.md\n<!-- bounds-md v1 -->\n\n<!-- team notes/);
  assert.match(out, /## Testing\nowner:\n- TESTING-2 MUST run tests before push\n- TESTING-3 NEVER skip failing tests — a red test is information even when the release is late\n/);
  assert.match(out, /- BILL-1 NEVER store card numbers\n- BILL-2 SHOULD round to cents — accountants/);
  assert.match(out, /## Billing\nsome prose note\nowner: @kate/);
  assert.match(out, /## Glossary\nowner: @lead\n- buyer — a person who orders\n- section — group of rules · avoid: category\n$/);
  assert.ok(sameContent(MESSY, out));
  assert.equal(contentHash(MESSY), contentHash(out));
});

test('sameContent rejects any change to what people wrote', () => {
  const out = format(MESSY);
  const changed = {
    'rule text': out.replace('store card numbers', 'store card numbers encrypted'),
    'rule level': out.replace('BILL-1 NEVER', 'BILL-1 SHOULD'),
    'existing ID': out.replace('BILL-1 NEVER', 'BILL-9 NEVER'),
    'rule removed': out.replace('- BILL-1 NEVER store card numbers\n', ''),
    'rule moved to another section': out.replace('- BILL-1 NEVER store card numbers\n', '').replace('- PRODUCT-1', '- BILL-1 NEVER store card numbers\n- PRODUCT-1'),
    'owner': out.replace('owner: @kate', 'owner: @bob'),
    'note': out.replace('some prose note', 'another note'),
    'comment': out.replace('team notes', 'team rules'),
    'term meaning': out.replace('a person who orders', 'a person who pays'),
    'avoid list': out.replace('avoid: category', 'avoid: category, group'),
    'section renamed': out.replace('## Billing', '## Payments'),
  };
  for (const [what, text] of Object.entries(changed)) assert.equal(sameContent(MESSY, text), false, what);
});

test('doctor reports, and with --fix rewrites only the layout', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-doc-'));
  const run = (...args) => execFileSync('node', [HOOK, 'doctor', ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8' });
  assert.match(run(), /no BOUNDS\.md/);
  fs.writeFileSync(path.join(project, 'BOUNDS.md'), MESSY);
  assert.match(run(), /differs from the standard .* run with --fix/);
  assert.equal(fs.readFileSync(path.join(project, 'BOUNDS.md'), 'utf8'), MESSY, 'no --fix, no write');
  const fixed = run('--fix');
  assert.match(fixed, /layout: fixed .*new IDs: TESTING-3, BILL-2.*Content is unchanged/);
  assert.match(fixed, /content issues/);
  assert.equal(fs.readFileSync(path.join(project, 'BOUNDS.md'), 'utf8'), format(MESSY));
  assert.match(run(), /layout: matches the standard/);
});

test('Claude still cannot edit BOUNDS.md itself, even a layout-only change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-'));
  fs.writeFileSync(path.join(dir, 'BOUNDS.md'), MESSY);
  assert.ok(guard('Write', { file_path: path.join(dir, 'BOUNDS.md'), content: format(MESSY) }, dir));
  assert.equal(bashTouchesBoundsMd(`node "${HOOK}" doctor --fix`), false, 'the doctor command is allowed');
});

// --- nested files and scoped sections (CLAUDE.md-style loading) ---------------
import { globToRegExp, inScope, ancestorFiles, nestedFilesFor, allFiles, loadView, crossCheck } from '../scripts/scope.mjs';

test('globs and scopes match like path patterns', () => {
  assert.ok(globToRegExp('src/**').test('src/a/b.ts'));
  assert.ok(globToRegExp('**/*.tsx').test('a/b/c.tsx'));
  assert.ok(globToRegExp('**/*.tsx').test('c.tsx'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('src/{ui,web}/**').test('src/web/x.ts'));
  assert.ok(inScope('src/ui/**, hooks/**', '/p/BOUNDS.md', '/p/hooks/a.json'));
  assert.ok(inScope('src/ui', '/p/BOUNDS.md', '/p/src/ui/kit/Button.tsx'), 'plain directory means everything inside');
  assert.ok(inScope('**', '/p/pkg/BOUNDS.md', '/p/pkg/x.ts'), 'relative to the BOUNDS.md directory');
  assert.ok(!inScope('**', '/p/pkg/BOUNDS.md', '/p/other/x.ts'));
});

function monorepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-mono-'));
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  w('BOUNDS.md', `# BOUNDS.md\n<!-- bounds-md v1 -->\n\n## Backend\nowner: @boris\n- BACKEND-1 NEVER log personal data — GDPR\n\n## UI\nowner: @anna\nscope: src/ui/**\n- UI-1 NEVER add CSS frameworks — styling lives in the kit\n- UI-2 MUST use kit components\n\n## Glossary\nowner: @lead\n- buyer — a person who orders · avoid: customer\n`);
  w('packages/web/BOUNDS.md', `# BOUNDS.md\n<!-- bounds-md v1 -->\n\n## Web\nowner: @wendy\n- WEB-1 NEVER call the API without the client wrapper — retries\n- UI-1 MUST lazy-load routes\n\n## Glossary\nowner: @wendy\n- buyer — a person with a cart\n- customer — a company account\n`);
  w('src/ui/a.tsx', 'x');
  w('packages/web/src/x.ts', 'x');
  return root;
}

test('finds files above, below and along a path', () => {
  const root = monorepo();
  assert.deepEqual(ancestorFiles(path.join(root, 'packages/web')).slice(-2), [path.join(root, 'BOUNDS.md'), path.join(root, 'packages/web/BOUNDS.md')]);
  assert.deepEqual(nestedFilesFor(root, path.join(root, 'packages/web/src/x.ts')), [path.join(root, 'packages/web/BOUNDS.md')]);
  assert.deepEqual(nestedFilesFor(root, path.join(root, 'src/ui/a.tsx')), []);
  assert.deepEqual(allFiles(root).map((f) => path.relative(root, f)).sort(), ['BOUNDS.md', 'packages/web/BOUNDS.md']);
});

test('load view shows scoped sections as a summary only', () => {
  const view = loadView(fs.readFileSync(path.join(monorepo(), 'BOUNDS.md'), 'utf8'));
  assert.match(view, /BACKEND-1 NEVER log personal data/);
  assert.match(view, /## UI\nscope: src\/ui\/\*\*\n\(2 rule\(s\): UI-1, UI-2 — the full text loads/);
  assert.doesNotMatch(view, /add CSS frameworks/);
});

test('hooks load nested files and scoped sections on demand, per agent, again after compact', () => {
  const root = monorepo();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-data-')) };
  const hook = (event, input) => {
    const outText = execFileSync('node', [HOOK, event], { input: JSON.stringify({ cwd: root, session_id: 's1', ...input }), env, encoding: 'utf8' });
    return outText ? JSON.parse(outText) : null;
  };
  const read = (rel, extra = {}) => hook('post-tool', { tool_name: 'Read', tool_input: { file_path: path.join(root, rel) }, ...extra });

  const start = hook('session-start', { source: 'startup' });
  assert.match(start.hookSpecificOutput.additionalContext, /BOUNDS\.md files also exist in: packages\/web/);
  assert.doesNotMatch(start.hookSpecificOutput.additionalContext, /add CSS frameworks/);
  assert.match(start.systemMessage, /\+1 nested/);

  const ui = read('src/ui/a.tsx');
  assert.match(ui.hookSpecificOutput.additionalContext, /UI-1 NEVER add CSS frameworks/);
  assert.match(ui.systemMessage, /loaded UI rules \(src\/ui\/\*\*\)/);
  assert.equal(read('src/ui/a.tsx'), null, 'loaded once per agent');

  const web = read('packages/web/src/x.ts');
  assert.match(web.hookSpecificOutput.additionalContext, /WEB-1 NEVER call the API/);
  assert.match(web.systemMessage, /loaded packages\/web\/BOUNDS\.md/);

  const sub = read('src/ui/a.tsx', { agent_id: 'a1' });
  assert.match(sub.hookSpecificOutput.additionalContext, /UI-1 NEVER add CSS frameworks/, 'a subagent gets its own copy');

  hook('session-start', { source: 'compact' });
  assert.match(read('src/ui/a.tsx').hookSpecificOutput.additionalContext, /UI-1 NEVER/, 'reloads after compact');

  read('packages/web/src/x.ts');
  fs.appendFileSync(path.join(root, 'packages/web/BOUNDS.md'), '- WEB-2 SHOULD keep bundles small\n');
  const changed = hook('prompt-submit', {});
  assert.match(changed.hookSpecificOutput.additionalContext, /WEB-2 SHOULD keep bundles small/);
  assert.match(changed.systemMessage, /changed — reloaded/);

  const edit = hook('post-tool', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'packages/web/src/x.ts'), old_string: 'x', new_string: 'const customerId = 1' } });
  // A nested file never cancels the root: "customer" stays avoided there too. The clash itself is a doctor warning.
  assert.match(edit.hookSpecificOutput.additionalContext, /"customer" → "buyer"/);
  const rootEdit = hook('post-tool', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/ui/a.tsx'), old_string: 'x', new_string: 'const customerId = 1' } });
  assert.match(rootEdit.hookSpecificOutput.additionalContext, /"customer" → "buyer"/);
});

test('crossCheck and doctor report overrides between files', () => {
  const root = monorepo();
  const files = allFiles(root).map((file) => ({ file, rel: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }));
  const w = crossCheck(files).join('\n');
  assert.match(w, /UI-1 exists in both BOUNDS\.md and packages\/web\/BOUNDS\.md/);
  assert.match(w, /term "buyer" in packages\/web\/BOUNDS\.md redefines the one in BOUNDS\.md/);
  assert.match(w, /"customer" is avoided in BOUNDS\.md but defined as a term in packages\/web\/BOUNDS\.md/);
  const report = execFileSync('node', [HOOK, 'doctor'], { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });
  assert.match(report, /overrides between files \(people decide\):/);
  assert.match(report, /packages\/web\/BOUNDS\.md\n {2}2 rule\(s\)/);
});
