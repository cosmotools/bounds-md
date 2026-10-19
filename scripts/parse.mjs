// Parses BOUNDS.md into a document model that keeps everything a person wrote:
// rules, terms, owners, scopes, notes and comments. Layout is not kept — format.mjs rebuilds it.

export const LEVELS = ['NEVER', 'MUST NOT', 'MUST', 'SHOULD NOT', 'SHOULD'];

// Lenient on purpose: "- [ui-3] must ..." is still a rule; the formatter fixes its layout.
const RULE_RE = new RegExp(`^- (?:\\[?([A-Za-z][A-Za-z0-9_]*-\\d+)\\]?\\s+)?(${LEVELS.join('|')})\\b:?\\s*(.+)$`, 'i');

const GLOSSARY_TITLE = /^(glossary|глоссарий|словарь)$/i;

export const VERSION_MARKER_RE = /^<!--\s*bounds-md\s+v(\d+)\s*-->$/i;

export function isGlossary(section) {
  return GLOSSARY_TITLE.test(section.title);
}

// Whitespace and dash style are layout, not content: "a -- b", "a - b" and "a — b" are the same text.
export function normText(text) {
  return text.replace(/\s+/g, ' ').replace(/ (--|–|-|—) /g, ' — ').trim();
}

// "- раздел = section — a group of rules for one area · avoid: category, group"
export function parseTerm(body) {
  let rest = body;
  let avoid = [];
  // Only a separated "· avoid:" starts the list, so a meaning may mention the word "avoid:" itself.
  const a = rest.match(/\s+[·|]\s*avoid\s*:\s*(.+)$/i);
  if (a) {
    avoid = a[1].split(',').map((s) => s.trim()).filter(Boolean);
    rest = rest.slice(0, a.index);
  }
  const dash = rest.search(/\s[—–-]\s/);
  const names = dash === -1 ? rest : rest.slice(0, dash);
  const meaning = dash === -1 ? null : rest.slice(dash + 3).trim() || null;
  return { names: names.split('=').map((s) => s.trim()).filter(Boolean), meaning, avoid };
}

function newSection(title, line) {
  return { title, line, owner: null, scope: null, hasOwner: false, hasScope: false, notes: [], rules: [], terms: [], bad: [] };
}

export function parse(text) {
  const doc = { title: null, version: null, preamble: [], sections: [], problems: [] };
  let section = null;
  let item = null; // the rule or term that indented lines continue
  let comment = null; // lines of an unfinished <!-- ... --> block

  const addNote = (note) => {
    const marker = note.match(VERSION_MARKER_RE);
    if (marker && !section) doc.version = Number(marker[1]);
    else (section ? section.notes : doc.preamble).push(note);
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (comment) {
      comment.push(line);
      if (line.includes('-->')) {
        addNote(comment.join('\n'));
        comment = null;
      }
      continue;
    }
    if (line.trimStart().startsWith('<!--')) {
      item = null;
      if (line.includes('-->')) addNote(line.trim());
      else comment = [line];
      continue;
    }

    if (!section && !doc.title && /^#\s+\S/.test(line)) {
      doc.title = line.trim();
      continue;
    }
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = newSection(heading[1], lineNo);
      doc.sections.push(section);
      item = null;
      continue;
    }

    const meta = section && line.match(/^(owner|scope)\s*:\s*(.*)$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      section[key] = meta[2].trim() || null;
      section[key === 'owner' ? 'hasOwner' : 'hasScope'] = true;
      item = null;
      continue;
    }

    if (section && line.startsWith('- ')) {
      if (isGlossary(section)) {
        item = { ...parseTerm(line.slice(2).trim()), line: lineNo, isTerm: true };
        section.terms.push(item);
        continue;
      }
      const m = line.match(RULE_RE);
      if (m) {
        item = { id: m[1] ? m[1].toUpperCase() : null, level: m[2].toUpperCase().replace(/\s+/g, ' '), text: m[3].trim(), line: lineNo, section: section.title };
        section.rules.push(item);
      } else {
        item = null;
        section.bad.push(line.trim());
        doc.problems.push({ kind: 'format', line: lineNo, msg: `list item without a level (${LEVELS.join('/')}): "${line.slice(2, 70)}"` });
      }
      continue;
    }

    if (item && /^\s+\S/.test(line)) {
      if (item.isTerm) {
        const avoid = line.trim().match(/^[·|]?\s*avoid\s*:\s*(.+)$/i);
        if (avoid) item.avoid.push(...avoid[1].split(',').map((s) => s.trim()).filter(Boolean));
        else item.meaning = item.meaning ? `${item.meaning} ${line.trim()}` : line.trim();
      } else {
        item.text += ' ' + line.trim();
      }
      continue;
    }

    item = null;
    if (line.trim()) addNote(line.trim());
  }
  if (comment) addNote(comment.join('\n'));
  return doc;
}
