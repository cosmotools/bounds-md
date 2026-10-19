---
name: review
description: Review BOUNDS.md for vague, duplicated, contradictory, outdated or bloated rules and suggest exact fixes. Use when the user asks to check, review, audit or clean up BOUNDS.md.
---

Do a thorough review of BOUNDS.md. You cannot edit it: every fix is a ready-to-paste line for the user.

Check each rule for:
1. **Format** — `- ID LEVEL text — why`; LEVEL is NEVER, MUST, MUST NOT, SHOULD or SHOULD NOT; IDs use the section prefix and are unique.
2. **Checkable** — could someone look at a diff and tell whether it was followed? Flag words like "clean", "good", "properly", "when needed", "хорошо", "правильно" and propose a concrete version.
3. **Boundary, not description** — a rule limits what may be done. Lines that explain how the code works belong in CLAUDE.md or docs; say so.
4. **Conflicts** — rules (often in different sections) that cannot both be followed, or whose scopes overlap with opposite demands.
5. **Reality** — search the code: rules the code already breaks, `scope:` paths that don't exist, rules about things the project no longer has.
6. **Weight** — sections that are long, repetitive or mostly low-value SHOULDs. Recommend what to merge or drop; there is no fixed limit, the goal is that every line earns its place in every session's context.
7. **Gaps** — at most 3 important boundaries that seem missing given what the code does (e.g. touching auth, migrations, public APIs), as suggestions.

Output grouped by section: rule ID → problem → suggested line. Start with a one-line verdict. Keep it scannable.
