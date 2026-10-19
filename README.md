# bounds

**BOUNDS.md: project boundaries written by people, enforced for Claude Code.**

As a project grows, so do `CLAUDE.md`, the docs and the skills, and at some point nobody knows what Claude is actually told anymore. `BOUNDS.md` is a separate, short file with one job: say what must and must not happen in each area of the project, and who decides. People write it. Claude reads it and cannot change what it says; only `/bounds:doctor` may tidy its layout.

| | CLAUDE.md | BOUNDS.md |
|---|---|---|
| Written by | Claude and people | people only |
| Contains | how the project works | what is allowed, required and forbidden |
| Grows | with the codebase | only when a boundary changes |
| Priority | regular context | outranks every other instruction |

## Install

```
/plugin marketplace add cosmotools/bounds-md
/plugin install bounds@bounds-md
```

Then run `/bounds:init` in your project, or just create a `BOUNDS.md` in the project root. Nothing else to configure: no `CLAUDE.md` import, no settings changes.

## What it looks like

```markdown
## Backend
owner: @boris
scope: src/server/**
- BACKEND-1 NEVER log personal data (email, phone, tokens) — GDPR
- BACKEND-2 MUST access the DB only through repo.ts
```

Asked to "add a console.log of req.body in createUser", Claude replies:

> I stopped and did not make this change. `src/server/users.ts:3` destructures `{ email, phone }` from `req.body`, so logging it would break **BACKEND-1**. Since it's a NEVER rule, I need you to decide. Options: log only non-personal fields, log a masked version, or ask @boris, who owns the Backend section, to change the rule.

Asked to delete that rule from `BOUNDS.md`, Claude is blocked by the plugin and gives you the line to remove by hand instead.

## What the plugin does

| When | What happens |
|---|---|
| Session starts | Loads `BOUNDS.md` from the project directory and the directories above it, the same way CLAUDE.md loads, with instructions on how to follow it. You see `BOUNDS.md: 7 rule(s) in 4 section(s)` in the chat. |
| Claude reads or edits a file in a subdirectory that has its own `BOUNDS.md` | That file loads, as a nested CLAUDE.md does. You see `BOUNDS.md: loaded packages/web/BOUNDS.md`. |
| Claude reads or edits a file matching a section's `scope:` | That section's full rules load, like `.claude/rules` with `paths:`. Until then Claude sees only the section's name, scope and rule IDs. You see `BOUNDS.md: loaded UI rules (src/ui/**)`. |
| Claude starts a subagent | The subagent gets the same rules. Subagents don't inherit the main session's context, so without this they would not know the rules. |
| The file is new or has changed | In its next reply Claude gives a short review: vague wording, conflicting rules, rules that describe code instead of bounding it, rules the current code already breaks. Each problem comes with a ready-to-paste replacement line. |
| A person edits the file mid-session | On your next message Claude gets the new version and reviews it. |
| Claude tries to change BOUNDS.md | Blocked, both through the Edit/Write tools and through the shell (`sed -i`, `>>`, `tee`, `rm`, `mv`…). Creating the file from scratch is allowed. The one exception is `/bounds:doctor`, which may rewrite the layout but never the content. |
| Claude edits a file using a word the glossary says to avoid | Claude gets a warning right after the edit and renames it, or explains why the word stays. Nothing is blocked. |
| There is no BOUNDS.md | Suggests `/bounds:init` once per project. |

Commands:
- `/bounds:init` creates `BOUNDS.md` from the template and suggests a few rules for your project in the chat. It doesn't write them into the file, because rules come from people.
- `/bounds:doctor` brings every BOUNDS.md in the project to the [standard layout](SPEC.md): section order, one-line rules sorted by ID, missing IDs, glossary order, format version. Before it writes, it compares the content of the file before and after the rewrite, and refuses if anything differs. It then lists what only people can fix, overrides between files, and lines in CLAUDE.md that would work better as rules.
- `/bounds:review` runs a full review: format, whether each rule can be checked, conflicts, a check against the code, rules worth dropping, and missing boundaries.

There are no hard limits on size. If the file gets long or the rules get weak, Claude recommends what to merge or drop.

## Format

The full standard, including what counts as content and what counts as layout, is in [SPEC.md](SPEC.md). In short:


- **Sections.** The template comes with Product, Architecture, UI, Backend, Data, Testing, Security, Dependencies and Process. Add your own freely. An empty section means no boundaries there.
- **Section metadata.** `owner:` is who decides on the section. `scope:` limits it to matching paths and is optional.
- **Rules.** One line each: `- ID LEVEL text — why`. The ID is the section prefix plus a number, e.g. `UI-3`. Don't reuse the ID of a deleted rule.
- **Levels.**
  - `NEVER`, `MUST` and `MUST NOT` are hard limits. Claude stops, names the rule ID and offers options instead of working around it.
  - `SHOULD` and `SHOULD NOT` are defaults. Claude may deviate, but says so and explains why.
- **Comments.** `<!-- -->` blocks are notes for people and are never read as rules.
- **Glossary.** The `## Glossary` section holds terms instead of rules; see below.

### Nested files and scopes

BOUNDS.md loads the way CLAUDE.md does. If you know one, you know the other.

- **Files above the project directory and in it** load when the session starts.
- **A BOUNDS.md in a subdirectory** (e.g. `packages/web/BOUNDS.md`) adds rules for that directory. It loads when Claude reads or edits a file there.
- **A section with `scope:`** loads its full rules when Claude reads or edits a matching file. Paths are relative to the BOUNDS.md the section is in.
- **After `/compact` or `/clear`**, anything loaded on demand loads again when it's needed.
- **Subagents** get the same files at start and load their own on demand.

There is one deliberate difference. With CLAUDE.md, files just add up, and if two contradict each other Claude may follow either one. With BOUNDS.md, files also add up, and a nested file never cancels a rule from a file above it. When two rules that apply conflict, Claude follows the stricter one and tells you. `/bounds:doctor` lists every override between files, so you can remove it at the source: a rule ID used in two files, a glossary term redefined in a nested file, a word avoided in one file but defined in another, a scope reaching outside its file's directory.

### Glossary

A `## Glossary` section fixes the project's vocabulary, so people and Claude call one thing by one name:

```markdown
## Glossary
owner: @lead
- collection — a group of products shown together in the shop · avoid: category, catalog
- buyer — a person who places an order · avoid: user, customer, client
- раздел = section — a group of rules for one area
```

- **Term line.** One per line: `- term — meaning · avoid: other, words`. The avoid list is optional.
- **Same term in two languages.** Names joined by `=` are one term. Claude uses the name that matches the language it is writing in.
- **Claude's side.** Claude uses the terms in chat, code, comments and docs. When a task is phrased with avoided words, it uses the term instead and says so. It also suggests a new term when a concept is called two things or has no name yet.
- **Edits.** After each edit Claude makes, avoided words the edit added are flagged, including inside identifiers (`categoryId`, `user_group`). This is a warning, not a stop. Words already in the code are left alone; `/bounds:review` reports how often they still appear.

Asked to "return products grouped by category and the total of a customer's cart" with the glossary above, Claude wrote `groupProductsByCollection` and `buyerCartTotal`. It said it had used the glossary terms, and proposed a new term for *cart*.

### Writing good rules

A good rule can be checked against a diff. "Write clean code" can't; "NEVER use inline styles" can.

This repository has its own [BOUNDS.md](BOUNDS.md): the plugin's boundaries, plus a glossary of every term used here, in English and Russian. It's also a complete example of the format.

## How it works

```
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   lets /plugin install it from this repo
hooks/hooks.json                  SessionStart, SubagentStart, UserPromptSubmit, PreToolUse, PostToolUse
scripts/bounds.mjs                hook handlers and the doctor
scripts/parse.mjs                 BOUNDS.md → document model
scripts/format.mjs                standard layout, content-equality check
scripts/scope.mjs                 file discovery, scope matching, on-demand loading, overrides
scripts/lib.mjs                   checks, edit protection, glossary matching, state
skills/init/SKILL.md              /bounds:init (template inside)
skills/doctor/SKILL.md            /bounds:doctor
skills/review/SKILL.md            /bounds:review
SPEC.md                           the BOUNDS.md format standard
test/bounds.test.mjs              npm test
```

It has no dependencies; Node is all it needs. The plugin remembers which version of the file was last reviewed. It stores this outside your project, in `$CLAUDE_PLUGIN_DATA` or, if that isn't set, in `~/.cache/bounds-md/`.

## Limitations

- **The doctor runs as a script.** Claude starts it with a shell command, so in interactive mode you approve that command the first time.
- **Only Claude is locked out.** People and other tools edit `BOUNDS.md` as usual.
- **Shell protection is an allow-list.** A shell command that mentions `BOUNDS.md` passes only if it is a known read-only command (`cat`, `grep`, `git diff`…). Anything else is blocked, including harmless things like `cp BOUNDS.md backup.md`. That's on purpose.
- **Glossary matching is by whole words.** Plurals and other word forms (`categories`, `категории`) are not matched unless listed in the avoid list. Edits made through the shell are not checked.
- **Following the rules is still up to the model.** In our tests Claude reliably stopped on clear NEVER/MUST rules. The meaning-level review (conflicts, outdated rules) is the model's judgement, not a guarantee.

## Development

```
npm test                                  # unit + hook tests
claude plugin validate .                  # manifest check
claude --plugin-dir . -p "..."            # try it in a project without installing
```

## License

MIT
