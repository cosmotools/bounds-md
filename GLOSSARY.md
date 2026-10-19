# Glossary

Terms as this project uses them in code, docs and discussion. Standard Claude Code terms (plugin, marketplace, hook, skill) are not repeated here.

## The file

| Term | Meaning |
|---|---|
| **boundaries** | What the people on a project allow, require and forbid. The meaning of BOUNDS.md as a whole. |
| **rule** | One line in BOUNDS.md that states one boundary: `- UI-2 NEVER add CSS frameworks — styling lives in the kit`. |
| **section** | A `## Heading` in BOUNDS.md that groups the rules for one area of the project, e.g. UI or Backend. |
| **owner** | The person who decides on a section's rules (`owner:` line). |
| **scope** | The paths a section applies to (`scope:` line). No scope means the whole project. |
| **rule ID** | A rule's stable name: section prefix plus a number, e.g. `UI-2`. IDs of deleted rules are not reused. |
| **level** | How strict a rule is: `NEVER`, `MUST`, `MUST NOT`, `SHOULD` or `SHOULD NOT`. |
| **hard rule** | A rule at `NEVER`, `MUST` or `MUST NOT`. Claude stops rather than break it. |
| **default** | A rule at `SHOULD` or `SHOULD NOT`. Claude may deviate if it says why. |
| **why** | The reason after the `—` in a rule. Optional, but it helps people and Claude judge edge cases. |

## Behaviour

| Term | Meaning |
|---|---|
| **violation** | A requested change, or code already in the project, that goes against a rule. |
| **stop** | What Claude does when a task would break a hard rule: it makes no change, names the rule ID and offers options. |
| **deviation** | Claude not following a default, stated openly with the rule ID and the reason. |
| **protection** | The plugin blocking Claude from changing BOUNDS.md through any tool, including the shell. |
| **checks** | Automated, script-only checks of BOUNDS.md: format, IDs, duplicates, vague words, missing owners. No model involved. |
| **review** | Claude reading BOUNDS.md for meaning: conflicts, outdated rules, rules the code already breaks, rules worth dropping. Runs when the file is new or has changed, or on `/bounds:review`. |
| **vague rule** | A rule nobody could check against a diff, e.g. "write clean code". |
| **description** | A line that explains how the code works instead of bounding what may be done. It belongs in CLAUDE.md or docs, not BOUNDS.md. |
| **conflict** | Two rules that cannot both be followed. |
