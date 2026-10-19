# bounds

**BOUNDS.md: project boundaries written by people, enforced for Claude Code.**

[Русская версия](README.ru.md)

As a project grows, so do `CLAUDE.md`, the docs and the skills, and at some point nobody knows what Claude is actually told anymore. `BOUNDS.md` is a separate, short file with one job: say what must and must not happen in each area of the project, and who decides. People write it. Claude reads it and cannot change it.

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
| Session starts | Finds `BOUNDS.md` in the project root and gives it to Claude with instructions on how to follow it. You see `BOUNDS.md: 7 rule(s) in 4 section(s)` in the chat. |
| The file is new or has changed | In its next reply Claude gives a short review: vague wording, conflicting rules, rules that describe code instead of bounding it, rules the current code already breaks. Each problem comes with a ready-to-paste replacement line. |
| A person edits the file mid-session | On your next message Claude gets the new version and reviews it. |
| Claude tries to change BOUNDS.md | Blocked, both through the Edit/Write tools and through the shell (`sed -i`, `>>`, `tee`, `rm`, `mv`…). Creating the file from scratch is allowed. |
| There is no BOUNDS.md | Suggests `/bounds:init` once per project. |

Commands:
- `/bounds:init` creates `BOUNDS.md` from the template and suggests a few rules for your project in the chat. It doesn't write them into the file, because rules come from people.
- `/bounds:review` runs a full review: format, whether each rule can be checked, conflicts, a check against the code, rules worth dropping, and missing boundaries.

There are no hard limits on size. If the file gets long or the rules get weak, Claude recommends what to merge or drop.

## Format

- **Sections.** The template comes with Product, Architecture, UI, Backend, Data, Testing, Security, Dependencies and Process. Add your own freely. An empty section means no boundaries there.
- **Section metadata.** `owner:` is who decides on the section. `scope:` limits it to matching paths and is optional.
- **Rules.** One line each: `- ID LEVEL text — why`. The ID is the section prefix plus a number, e.g. `UI-3`. Don't reuse the ID of a deleted rule.
- **Levels.**
  - `NEVER`, `MUST` and `MUST NOT` are hard limits. Claude stops, names the rule ID and offers options instead of working around it.
  - `SHOULD` and `SHOULD NOT` are defaults. Claude may deviate, but says so and explains why.
- **Comments.** `<!-- -->` blocks are notes for people and are never read as rules.

A good rule can be checked against a diff. "Write clean code" can't; "NEVER use inline styles" can.

## How it works

```
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   lets /plugin install it from this repo
hooks/hooks.json                  SessionStart, UserPromptSubmit, PreToolUse
scripts/bounds.mjs                hook handlers
scripts/lib.mjs                   parsing, checks, edit protection, state
skills/init/SKILL.md              /bounds:init (template inside)
skills/review/SKILL.md            /bounds:review
test/bounds.test.mjs              npm test
```

It has no dependencies; Node is all it needs. The plugin remembers which version of the file was last reviewed. It stores this outside your project, in `$CLAUDE_PLUGIN_DATA` or, if that isn't set, in `~/.cache/bounds-md/`.

## Limitations

- **Only Claude is locked out.** People and other tools edit `BOUNDS.md` as usual.
- **Shell protection is an allow-list.** A shell command that mentions `BOUNDS.md` passes only if it is a known read-only command (`cat`, `grep`, `git diff`…). Anything else is blocked, including harmless things like `cp BOUNDS.md backup.md`. That's on purpose.
- **Following the rules is still up to the model.** In our tests Claude reliably stopped on clear NEVER/MUST rules. The meaning-level review (conflicts, outdated rules) is the model's judgement, not a guarantee.

## Development

```
npm test                                  # unit + hook tests
claude plugin validate .                  # manifest check
claude --plugin-dir . -p "..."            # try it in a project without installing
```

## License

MIT
