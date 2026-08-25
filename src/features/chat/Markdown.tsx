/**
 * Renderer markdown untuk jawaban AI (gaya chat modern):
 * heading, bold, list, tabel, dan code block dengan styling gelap.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}