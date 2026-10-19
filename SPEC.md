# BOUNDS.md format — v1

This is the standard layout of a BOUNDS.md file. `/bounds:doctor` rewrites any BOUNDS.md to it. The doctor changes the layout only, never the content. Words in **bold** are defined in the Glossary of this repo's [BOUNDS.md](BOUNDS.md).

## Content and layout

What people write is **content**. Only people change it.
- the text and **level** of every **rule**, and the **rule IDs** it already has;
- section names, **owner** and **scope** values;
- every **term**: its names, meaning and avoid list;
- notes and `<!-- comments -->`.

Everything else is **layout**. The doctor may change it.
- order of sections, rules and terms;
- spacing, line breaks and the style of the dash before the **why** (`--`, `-` and `–` become `—`);
- upper case for levels and IDs; `[UI-1]` becomes `UI-1`;
- IDs for rules that have none;
- the `owner:` line in every section, and the format version marker.

Before writing, the doctor parses the file both before and after and compares the content. If anything differs, it refuses to write.

## Layout

```markdown
# BOUNDS.md
<!-- bounds-md v1 -->

<!-- notes before the first section stay here -->

## Product
<!-- notes and comments of a section come right after its heading -->
owner: @someone
scope: src/**
- PRODUCT-1 NEVER ... — why
- PRODUCT-2 MUST ...

## Glossary
owner: @someone
- buyer — a person who places an order · avoid: user, customer
- раздел = section — a group of rules for one area
```

1. **Header.** First the `# BOUNDS.md` title, then the version marker `<!-- bounds-md v1 -->` on the next line.
2. **Section order.**
   - Standard sections come first, in this order: Product, Architecture, UI, Backend, Data, Testing, Security, Dependencies, Process. A standard name written in different case is normalised (`## testing` becomes `## Testing`).
   - Custom sections come next, in the order the authors wrote them.
   - Glossary is always last.
3. **Inside a section.** The heading comes first, then the section's notes and comments, then `owner:` (always present, may be empty), then `scope:` (only if the authors wrote it), then the rules, or the terms in the Glossary.
4. **Rules.** Each rule is one line: `- ID LEVEL text — why`.
   - Rules are sorted by ID number.
   - Rules whose ID prefix belongs to another section go at the end of the section. Moving them to their section is a content decision for people.
5. **Rule IDs.**
   - The prefix is the one most rules in the section already use. If no rule has an ID yet, it is the section name in upper case with spaces removed.
   - A rule without an ID gets the next free number.
   - Existing IDs are never renumbered.
6. **Terms.** Each term is one line: `- names — meaning · avoid: a, b`. Names in different languages are joined with ` = `. Terms are sorted alphabetically.
7. **Unparseable list items.** List items that have no level are kept as written, at the end of their section. The checks report them.
8. **Spacing.** One blank line between sections, and one newline at the end of the file.

## Versions

The marker records which version of this spec a file follows. When a new version changes the layout, the doctor migrates older files. A file without a marker is treated as v1.
