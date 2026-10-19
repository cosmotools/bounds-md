# BOUNDS.md

<!--
Boundaries for the bounds plugin itself, written by its maintainers.
This file is also the live example of the format: the plugin reads it when you work on this repo with the plugin installed.
-->

## Product
owner: @cosmotools
- PRODUCT-1 MUST work with nothing but a BOUNDS.md in the project root — no CLAUDE.md import, no settings, no config file
- PRODUCT-2 NEVER add hard limits on the number or length of rules or terms — size problems get recommendations, not blocks
- PRODUCT-3 NEVER let Claude write rules or terms into BOUNDS.md, including from /bounds:init — they come from people
- PRODUCT-4 MUST keep glossary violations as warnings, never stops — renames are too costly to block work

## Architecture
owner: @cosmotools
scope: scripts/**, hooks/**
- ARCH-1 NEVER add runtime dependencies — Node built-ins only, so the plugin installs without npm
- ARCH-2 MUST fail open: an error in a hook is reported on stderr and never breaks the user's session or blocks a tool call
- ARCH-3 MUST keep plugin state outside the user's project — $CLAUDE_PLUGIN_DATA or ~/.cache/bounds-md
- ARCH-4 SHOULD keep checks deterministic and in scripts/lib.mjs; anything needing judgement goes to Claude's review

## Testing
owner: @cosmotools
- TESTING-1 MUST add or update a test in test/ for every change to parsing, checks, protection or hook output
- TESTING-2 MUST run npm test and claude plugin validate . before pushing

## Security
owner: @cosmotools
- SECURITY-1 NEVER commit .env, tokens or personal email addresses — commits are authored as cosmotools

## Process
owner: @cosmotools
- PROCESS-1 MUST bump the version in .claude-plugin/plugin.json when user-visible behaviour changes
- PROCESS-2 SHOULD keep README.md in sync with behaviour in the same commit

## Glossary
owner: @cosmotools
<!-- The project's vocabulary. Names joined by "=" are the same term in English and Russian. -->
- boundaries = границы — what the people on a project allow, require and forbid; the meaning of BOUNDS.md as a whole · avoid: guardrails
- rule = правило — one line in BOUNDS.md that states one boundary, e.g. "- UI-2 NEVER add CSS frameworks — styling lives in the kit"
- section = раздел — a "## Heading" in BOUNDS.md grouping the rules for one area · avoid: category, категория
- owner = владелец — the person who decides on a section ("owner:" line)
- scope = область действия — the paths a section applies to ("scope:" line); no scope means the whole project
- rule ID = ID правила — section prefix plus a number, e.g. UI-2; IDs of deleted rules are not reused
- level = уровень — NEVER, MUST, MUST NOT, SHOULD or SHOULD NOT
- hard rule = жёсткое правило — a rule at NEVER, MUST or MUST NOT; Claude stops rather than break it
- default = правило по умолчанию — a rule at SHOULD or SHOULD NOT; Claude may deviate if it says why
- why = зачем — the reason after the "—" in a rule
- glossary = глоссарий — the "## Glossary" section: the project's agreed vocabulary
- term = термин — one glossary line: names of a concept, its meaning, words to avoid
- avoided word = слово «не использовать» — a word listed after "avoid:"; using it in an edit gives a warning, not a stop
- violation = нарушение — a requested change, or existing code, that goes against a rule
- stop = остановка — Claude makes no change, names the rule ID and offers options
- deviation = отступление — Claude openly not following a default, with the rule ID and the reason
- protection = защита — the plugin blocking Claude from changing BOUNDS.md through any tool, including the shell
- checks = проверка — automated, script-only checks of BOUNDS.md; no model involved · avoid: lint, linter
- review = ревью — Claude reading BOUNDS.md for meaning: conflicts, outdated rules, rules the code breaks · avoid: audit
- vague rule = размытая формулировка — a rule nobody could check against a diff, e.g. "write clean code"
- description = описание вместо границы — a line explaining how the code works instead of bounding it; belongs in CLAUDE.md
- conflict = конфликт — two rules that cannot both be followed
