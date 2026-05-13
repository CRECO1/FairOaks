import React, { type ElementType } from 'react';

/** Minimal recursive serializer for Payload 3 / Lexical JSON → React elements */

type LexicalNode = {
  type: string;
  version?: number;
  text?: string;
  format?: number;    // bitmask: 1=bold, 2=italic, 4=strikethrough, 8=underline, 16=code, 32=subscript, 64=superscript
  tag?: string;       // for heading: 'h1'–'h6'
  listType?: string;  // 'bullet' | 'number'
  value?: number;     // listitem ordinal
  indent?: number;
  url?: string;       // link
  children?: LexicalNode[];
  fields?: { url?: string; newTab?: boolean };
};

function serializeText(node: LexicalNode): React.ReactNode {
  const fmt = node.format ?? 0;
  let el: React.ReactNode = node.text ?? '';
  if (fmt & 16) el = <code key="code" className="rounded bg-background-cream px-1.5 py-0.5 font-mono text-sm text-primary">{el}</code>;
  if (fmt & 1)  el = <strong key="bold">{el}</strong>;
  if (fmt & 2)  el = <em key="italic">{el}</em>;
  if (fmt & 4)  el = <s key="strike">{el}</s>;
  if (fmt & 8)  el = <u key="under">{el}</u>;
  return el;
}

function serializeNode(node: LexicalNode, idx: number): React.ReactNode {
  const children = (node.children ?? []).map((c, i) => serializeNode(c, i));

  switch (node.type) {
    case 'root':
      return <React.Fragment key={idx}>{children}</React.Fragment>;

    case 'text':
      return <React.Fragment key={idx}>{serializeText(node)}</React.Fragment>;

    case 'paragraph':
      if (!children.length || (children.length === 1 && children[0] === '')) {
        return <br key={idx} />;
      }
      return <p key={idx} className="mb-4 leading-relaxed text-foreground-muted">{children}</p>;

    case 'heading': {
      const Tag = (node.tag ?? 'h2') as ElementType;
      const cls =
        node.tag === 'h1' ? 'font-heading text-display-sm font-bold text-primary mt-10 mb-4' :
        node.tag === 'h2' ? 'font-heading text-heading-lg font-bold text-primary mt-8 mb-3' :
        node.tag === 'h3' ? 'font-heading text-heading font-semibold text-primary mt-6 mb-2' :
                            'font-heading text-heading-sm font-semibold text-primary mt-5 mb-2';
      return <Tag key={idx} className={cls}>{children}</Tag>;
    }

    case 'list':
      return node.listType === 'number'
        ? <ol key={idx} className="mb-4 ml-6 list-decimal space-y-1 text-foreground-muted">{children}</ol>
        : <ul key={idx} className="mb-4 ml-6 list-disc space-y-1 text-foreground-muted">{children}</ul>;

    case 'listitem':
      return <li key={idx} className="leading-relaxed">{children}</li>;

    case 'quote':
      return (
        <blockquote key={idx} className="my-6 border-l-4 border-gold pl-5 italic text-foreground-muted">
          {children}
        </blockquote>
      );

    case 'code':
      return (
        <pre key={idx} className="my-6 overflow-x-auto rounded-xl bg-primary p-5 font-mono text-sm text-white/80">
          <code>{children}</code>
        </pre>
      );

    case 'link': {
      const href = node.fields?.url ?? node.url ?? '#';
      const external = node.fields?.newTab ?? href.startsWith('http');
      return (
        <a key={idx} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="font-semibold text-gold underline underline-offset-2 hover:text-gold/80 transition-colors">
          {children}
        </a>
      );
    }

    case 'horizontalrule':
      return <hr key={idx} className="my-8 border-border" />;

    default:
      return <React.Fragment key={idx}>{children}</React.Fragment>;
  }
}

export function RichTextRenderer({ content }: { content: any }) {
  if (!content?.root) return null;
  return (
    <div className="rich-text prose-article">
      {(content.root.children ?? []).map((node: LexicalNode, i: number) => serializeNode(node, i))}
    </div>
  );
}
