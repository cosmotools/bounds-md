---
name: doctor
description: Bring BOUNDS.md to the standard layout (section order, rule format, IDs, glossary order, format version) without touching its content, and report what only people can fix. Use when the user asks to tidy, normalize, fix, format or check the health of BOUNDS.md.
---

You are the only path allowed to rewrite BOUNDS.md, and only its layout. Never edit BOUNDS.md with any other tool or command.

1. From the project root, run the doctor script that ships with this plugin (it sits two levels above this skill's directory):
   ```
   node "<this skill's directory>/../../scripts/bounds.mjs" doctor --fix
   ```
   It rewrites the layout to the standard (see SPEC.md in the plugin) and refuses to write if the content would change. It prints the Node version, a summary, content issues and what it changed.
2. Tell the user in one or two lines what the layout fix did: how many lines changed and which rules got new IDs. If it said the layout already matches, say so.
3. Then go through what only people can decide, each with a ready-to-paste line or a concrete instruction:
   - each content issue the script printed;
   - rules whose ID prefix doesn't match their section — probably written in the wrong section;
   - custom sections that duplicate a standard one (e.g. "Tests" next to "Testing") and should be merged;
   - lines in CLAUDE.md or AGENTS.md that read like boundaries ("never", "always", "must", "не делай") and would be stronger as BOUNDS.md rules.
4. If the script printed "NOT fixed", do not try to fix the layout another way. Tell the user it looks like a bug in the plugin.
