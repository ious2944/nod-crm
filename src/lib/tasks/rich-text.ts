/**
 * Texte enrichi des descriptions et commentaires — fonctions pures.
 *
 * Format : un Markdown volontairement restreint (gras, italique, barré, code,
 * liens http(s)/mailto, listes à puces, numérotées et à cocher, titres,
 * citations) plus les mentions `@[Nom](uuid)`.
 *
 * Sécurité : le texte n'est **jamais** injecté comme HTML. Il est analysé en un
 * arbre de nœuds que le composant `RichText` rend en éléments React — React
 * échappe chaque chaîne. Les liens n'acceptent que `http:`, `https:` et
 * `mailto:` : `javascript:` et consorts sont rendus comme du texte.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "mention"; userId: string; label: string };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: "quote"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: { checked: boolean | null; children: InlineNode[] }[] }
  | { type: "code"; value: string };

const MENTION = /^@\[([^\]\n]{1,80})\]\(([0-9a-f-]{36})\)/;
const LINK = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/;
const AUTOLINK = /^(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push({ type: "text", value: buffer });
    buffer = "";
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);

    const mention = MENTION.exec(rest);
    if (mention) {
      flush();
      nodes.push({ type: "mention", label: mention[1], userId: mention[2] });
      i += mention[0].length;
      continue;
    }

    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end > 1) {
        flush();
        nodes.push({ type: "code", value: rest.slice(1, end) });
        i += end + 1;
        continue;
      }
    }

    const delimiters: [string, "bold" | "italic" | "strike"][] = [
      ["**", "bold"],
      ["~~", "strike"],
      ["*", "italic"],
      ["_", "italic"],
    ];
    let matched = false;
    for (const [marker, type] of delimiters) {
      if (!rest.startsWith(marker)) continue;
      const end = rest.indexOf(marker, marker.length);
      if (end > marker.length && !/\s/.test(rest[marker.length])) {
        flush();
        nodes.push({ type, children: parseInline(rest.slice(marker.length, end)) });
        i += end + marker.length;
        matched = true;
      }
      break;
    }
    if (matched) continue;

    const link = LINK.exec(rest);
    if (link) {
      flush();
      if (isSafeHref(link[2])) {
        nodes.push({ type: "link", href: link[2], children: parseInline(link[1]) });
      } else {
        nodes.push({ type: "text", value: link[0] });
      }
      i += link[0].length;
      continue;
    }

    const auto = AUTOLINK.exec(rest);
    if (auto && (i === 0 || /\s|\(/.test(source[i - 1]))) {
      flush();
      nodes.push({ type: "link", href: auto[1], children: [{ type: "text", value: auto[1] }] });
      i += auto[1].length;
      continue;
    }

    buffer += source[i];
    i += 1;
  }
  flush();
  return nodes;
}

export function parseRichText(source: string | null | undefined): BlockNode[] {
  if (!source) return [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim().startsWith("```")) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", value: code.join("\n") });
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2]),
      });
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      blocks.push({ type: "quote", children: parseInline(line.replace(/^>\s?/, "")) });
      continue;
    }

    const item = /^\s*(?:([-*])|(\d+)[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const ordered = Boolean(item[2]);
      const entry = {
        checked: item[3] === undefined ? null : item[3].toLowerCase() === "x",
        children: parseInline(item[4]),
      };
      const last = blocks[blocks.length - 1];
      if (last && last.type === "list" && last.ordered === ordered) {
        last.items.push(entry);
      } else {
        blocks.push({ type: "list", ordered, items: [entry] });
      }
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/** Identifiants des utilisateurs mentionnés, sans doublon. */
export function extractMentions(source: string): string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(/@\[[^\]\n]{1,80}\]\(([0-9a-f-]{36})\)/g)) {
    ids.add(match[1]);
  }
  return [...ids];
}

/** Version texte brut (aperçu de notification, export CSV). */
export function toPlainText(source: string | null | undefined): string {
  if (!source) return "";
  return source
    .replace(/@\[([^\]\n]{1,80})\]\([0-9a-f-]{36}\)/g, "@$1")
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/[*_~`#>]/g, "")
    .replace(/^\s*[-*]\s+(\[[ xX]\]\s+)?/gm, "• ")
    .trim();
}

/** Bascule la n-ième case à cocher d'une description (clic dans le rendu). */
export function toggleChecklistItem(source: string, ordinal: number): string {
  let seen = -1;
  return source
    .split("\n")
    .map((line) => {
      const match = /^(\s*(?:[-*]|\d+[.)])\s+)\[( |x|X)\]/.exec(line);
      if (!match) return line;
      seen += 1;
      if (seen !== ordinal) return line;
      const next = match[2] === " " ? "x" : " ";
      return `${match[1]}[${next}]${line.slice(match[0].length)}`;
    })
    .join("\n");
}
