/**
 * Renderer markdown gaya Qwen: code block dengan header bar
 * (label bahasa + tombol salin), heading, tabel, list.
 */
import { useState, type ReactNode } from 'react';
import { isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface CodeBlockProps {
  lang: string;
  text: string;
  children?: ReactNode;
}

function CodeBlock({ lang, text, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang}</span>
        <button onClick={handleCopy}>{copied ? '✓ tersalin' : '⧉ salin'}</button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  pre({ children }) {
    let lang = 'text';
    let text = '';
    if (isValidElement(children)) {
      const props = children.props as { className?: string; children?: ReactNode };
      lang = /language-([\w-]+)/.exec(props.className ?? '')?.[1] ?? 'text';
      text = String(props.children ?? '').replace(/\n$/, '');
    }
    return <CodeBlock lang={lang} text={text}>{children}</CodeBlock>;
  },
};

export function Markdown({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}