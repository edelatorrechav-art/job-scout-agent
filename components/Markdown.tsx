import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Each renderer drops `node` (the syntax-tree node react-markdown passes in)
// so it isn't spread onto the DOM element.
/* eslint-disable @typescript-eslint/no-unused-vars */

const components: Components = {
  p: ({ node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
  ol: ({ node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
  h1: ({ node, ...props }) => <h3 className="mt-4 mb-2 font-semibold" {...props} />,
  h2: ({ node, ...props }) => <h3 className="mt-4 mb-2 font-semibold" {...props} />,
  h3: ({ node, ...props }) => <h3 className="mt-4 mb-2 font-semibold" {...props} />,
  a: ({ node, ...props }) => (
    <a
      className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  code: ({ node, ...props }) => (
    <code
      className="rounded bg-zinc-200/70 px-1 py-0.5 font-mono text-[0.9em] dark:bg-zinc-700/70"
      {...props}
    />
  ),
  pre: ({ node, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded-lg bg-zinc-200/70 p-3 text-sm dark:bg-zinc-800 [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  table: ({ node, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => (
    <th
      className="border-b border-zinc-300 px-2 py-1 text-left font-semibold dark:border-zinc-600"
      {...props}
    />
  ),
  td: ({ node, ...props }) => (
    <td className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-700" {...props} />
  ),
};
/* eslint-enable @typescript-eslint/no-unused-vars */

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
