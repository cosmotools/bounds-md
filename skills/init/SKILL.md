---
name: init
description: Create a BOUNDS.md in the project root from the standard template. Use when the user wants to start a BOUNDS.md or set up project boundaries for Claude.
disable-model-invocation: true
---

1. If the project root already has a BOUNDS.md (any letter case), stop and say so. Never overwrite it.
2. Write the template below, exactly as it is, to `BOUNDS.md` in the project root with the Write tool. Creating the file is allowed; once it exists, the bounds plugin blocks Claude from changing it.
3. Look at the project briefly (top-level folders, package manifest) and suggest, in chat only, 3–5 example rules the user might want, plus 2–3 glossary terms if the code already shows a concept named in several ways. Group them under the template's section names, and write each as a ready-to-paste line in exactly this format: `- UI-1 NEVER add CSS frameworks — styling lives in the kit` (ID = section prefix, hyphen, number; then NEVER, MUST, MUST NOT, SHOULD or SHOULD NOT; then the rule; then `— why`). Do not write them into the file: rules must come from people.
4. Tell the user the file is now theirs to fill in, and that Claude will review it automatically whenever it changes.

## Template

````markdown
# BOUNDS.md
<!-- bounds-md v1 -->

<!--
Boundaries for this project, written by people. Claude reads this file in every session and cannot edit it.

- One line = one boundary someone could check against a diff: not "write clean code" but "NEVER use inline styles".
- Format: `- ID LEVEL text — why`. ID = section prefix + number, e.g. UI-3; don't reuse IDs of deleted rules.
- NEVER / MUST: Claude stops and asks instead of breaking it. SHOULD: Claude may deviate but must say why.
- `owner:` is who decides on the section; `scope:` limits it to paths (optional).
- Empty section = no boundaries there. Add your own sections freely.
- The Glossary section lists terms instead of rules; see the note there.
-->

## Product
<!-- What we are building and, more importantly, what we are not. -->
owner:

## Architecture
<!-- Module boundaries, allowed dependencies between layers, what must not be touched. -->
owner:

## UI
owner:
scope:

## Backend
owner:
scope:

## Data
<!-- Schema, migrations, personal data. -->
owner:

## Testing
owner:

## Security
owner:

## Dependencies
<!-- What may be added, what is banned, who approves. -->
owner:

## Process
<!-- Git, commits, releases, when to stop and ask a human. -->
owner:

## Glossary
<!-- The project's vocabulary. Claude uses these terms in chat, code and docs, and is warned when an edit uses an avoided word.
Format: `- term — meaning · avoid: other, words`. Same term in two languages: `- раздел = section — meaning`. -->
owner:
````
