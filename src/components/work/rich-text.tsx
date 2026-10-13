"use client";

import { Bold, Code, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, Strikethrough } from "lucide-react";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";

import { parseRichText, type BlockNode, type InlineNode } from "@/lib/tasks/rich-text";

import { useWork } from "./store";
import { Avatar } from "./ui";

/**
 * Rendu du texte enrichi : l'arbre produit par `parseRichText` est converti
 * en éléments React. Aucune chaîne n'est jamais interprétée comme du HTML.
 */

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "text":
            return <Fragment key={i}>{node.value}</Fragment>;
          case "bold":
            return (
              <strong key={i} className="font-semibold">
                <Inline nodes={node.children} />
              </strong>
            );
          case "italic":
            return (
              <em key={i}>
                <Inline nodes={node.children} />
              </em>
            );
          case "strike":
            return (
              <s key={i}>
                <Inline nodes={node.children} />
              </s>
            );
          case "code":
            return (
              <code key={i} className="rounded bg-surface-muted px-1 font-mono text-[12px]">
                {node.value}
              </code>
            );
          case "link":
            return (
              <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
                <Inline nodes={node.children} />
              </a>
            );
          case "mention":
            return (
              <span key={i} className="rounded bg-accent-soft px-1 font-medium text-accent">
                @{node.label}
              </span>
            );
        }
      })}
    </>
  );
}

export function RichText({
  source,
  onToggleCheck,
  className = "",
}: {
  source: string | null | undefined;
  onToggleCheck?: (ordinal: number) => void;
  className?: string;
}) {
  const blocks = useMemo(() => parseRichText(source), [source]);
  // Numéro de chaque case à cocher dans le document (pour la basculer).
  const ordinals = useMemo(() => {
    let n = -1;
    return blocks.map((block) => (block.type === "list" ? block.items.map((item) => (item.checked === null ? -1 : ++n)) : []));
  }, [blocks]);
  const render = (block: BlockNode, i: number): ReactNode => {
    switch (block.type) {
      case "paragraph":
        return (
          <p key={i} className="whitespace-pre-wrap">
            <Inline nodes={block.children} />
          </p>
        );
      case "heading": {
        const cls = block.level === 1 ? "text-[16px] font-bold" : block.level === 2 ? "text-[15px] font-semibold" : "text-[14px] font-semibold";
        return (
          <p key={i} role="heading" aria-level={block.level + 2} className={cls}>
            <Inline nodes={block.children} />
          </p>
        );
      }
      case "quote":
        return (
          <blockquote key={i} className="border-l-2 border-border-strong pl-3 text-muted">
            <Inline nodes={block.children} />
          </blockquote>
        );
      case "code":
        return (
          <pre key={i} className="overflow-x-auto rounded-md bg-surface-muted p-2 font-mono text-[12px]">
            {block.value}
          </pre>
        );
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag key={i} className={`${block.ordered ? "list-decimal" : block.items.some((it) => it.checked !== null) ? "list-none" : "list-disc"} space-y-0.5 pl-5`}>
            {block.items.map((item, j) => {
              if (item.checked === null) {
                return (
                  <li key={j}>
                    <Inline nodes={item.children} />
                  </li>
                );
              }
              const ordinal = ordinals[i][j];
              return (
                <li key={j} className="-ml-5 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={!onToggleCheck}
                    onChange={() => onToggleCheck?.(ordinal)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Élément de liste"
                    className="mt-1 h-3.5 w-3.5 accent-[var(--nod-accent)]"
                  />
                  <span className={item.checked ? "text-muted line-through" : ""}>
                    <Inline nodes={item.children} />
                  </span>
                </li>
              );
            })}
          </Tag>
        );
      }
    }
  };
  return <div className={`space-y-1.5 text-[13px] leading-relaxed text-ink ${className}`}>{blocks.map(render)}</div>;
}

/* ─── Éditeur ─────────────────────────────────────────────────────────────── */

function wrapSelection(textarea: HTMLTextAreaElement, before: string, after = before, placeholder = "texte") {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end) || placeholder;
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  return { next, cursor: [start + before.length, start + before.length + selected.length] as const };
}

function prefixLines(textarea: HTMLTextAreaElement, prefix: (index: number) => string) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const block = value.slice(lineStart, end);
  const replaced = block
    .split("\n")
    .map((line, i) => prefix(i) + line)
    .join("\n");
  const next = value.slice(0, lineStart) + replaced + value.slice(end);
  return { next, cursor: [lineStart, lineStart + replaced.length] as const };
}

/**
 * Zone de saisie Markdown avec barre d'outils et mentions `@` : taper `@`
 * propose les membres de l'espace ; la mention est encodée `@[Nom](id)`.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  minRows = 3,
  label,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  minRows?: number;
  label: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const users = useWork((s) => s.context?.users ?? []);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  const candidates = mention
    ? users
        .filter((u) => u.isActive && `${u.name} ${u.email}`.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 6)
    : [];

  const apply = (result: { next: string; cursor: readonly [number, number] }) => {
    onChange(result.next);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(result.cursor[0], result.cursor[1]);
    });
  };

  type Edit = (textarea: HTMLTextAreaElement) => { next: string; cursor: readonly [number, number] };
  const runTool = (action: Edit) => {
    const textarea = ref.current;
    if (textarea) apply(action(textarea));
  };

  const insertMention = (user: { id: string; name: string }) => {
    const textarea = ref.current;
    if (!textarea || !mention) return;
    const caret = textarea.selectionStart;
    const token = `@[${user.name.replace(/[\]\n]/g, "")}](${user.id}) `;
    const next = value.slice(0, mention.start) + token + value.slice(caret);
    setMention(null);
    apply({ next, cursor: [mention.start + token.length, mention.start + token.length] });
  };

  const detectMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = /(^|\s)@([^\s@[\]()]{0,30})$/.exec(before);
    if (match) {
      setMention({ start: caret - match[2].length - 1, query: match[2] });
      setActive(0);
    } else setMention(null);
  };

  const tools: { label: string; icon: typeof Bold; edit: Edit }[] = [
    { label: "Gras", icon: Bold, edit: (t) => wrapSelection(t, "**") },
    { label: "Italique", icon: Italic, edit: (t) => wrapSelection(t, "*") },
    { label: "Barré", icon: Strikethrough, edit: (t) => wrapSelection(t, "~~") },
    { label: "Code", icon: Code, edit: (t) => wrapSelection(t, "`") },
    { label: "Lien", icon: LinkIcon, edit: (t) => wrapSelection(t, "[", "](https://)", "lien") },
    { label: "Liste à puces", icon: List, edit: (t) => prefixLines(t, () => "- ") },
    { label: "Liste numérotée", icon: ListOrdered, edit: (t) => prefixLines(t, (i) => `${i + 1}. `) },
    { label: "Liste de contrôle", icon: ListChecks, edit: (t) => prefixLines(t, () => "- [ ] ") },
  ];

  return (
    <div className="relative rounded-md border border-border-strong bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      <div role="toolbar" aria-label="Mise en forme" className="flex flex-wrap gap-0.5 border-b border-border-subtle px-1 py-0.5">
        {tools.map((t) => (
          <button key={t.label} type="button" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => runTool(t.edit)} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-muted hover:text-ink">
            <t.icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        rows={Math.max(minRows, Math.min(16, value.split("\n").length + 1))}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detectMention(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (mention && candidates.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % candidates.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + candidates.length) % candidates.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insertMention(candidates[active]);
              return;
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setMention(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
            e.preventDefault();
            runTool(tools[0].edit);
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
            e.preventDefault();
            runTool(tools[1].edit);
          }
          onKeyDown?.(e);
        }}
        className="block w-full resize-none bg-transparent px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-muted/60"
      />
      {mention && candidates.length > 0 && (
        <ul role="listbox" aria-label="Mentionner" className="absolute left-2 top-full z-20 mt-1 w-60 rounded-md border border-border-subtle bg-surface py-1 shadow-dialog">
          {candidates.map((user, i) => (
            <li key={user.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(user)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] ${i === active ? "bg-surface-muted" : ""}`}
              >
                <Avatar user={user} size={18} />
                <span className="truncate">{user.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
