import type { Element, ElementContent, Root, RootContent } from "hast";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Marks up job-listing tables so they can be styled by column: cells under a
 * "Pay" header get data-col="pay", under "Link" data-col="link", and cells
 * reading "Not listed" get data-empty. Links inside tables get
 * data-variant="table-link" so they render as buttons.
 */
function rehypeLedgerTables() {
  return (tree: Root) => {
    visit(tree, (el) => {
      if (el.tagName !== "table") return;
      const rows = findAll(el, "tr");
      const header = rows[0] ? cellsOf(rows[0]) : [];
      const colOf = header.map((th) => {
        const t = textOf(th).trim().toLowerCase();
        return /^(pay|salary|compensation)/.test(t) ? "pay" : /^(link|apply|posting)/.test(t) ? "link" : null;
      });
      for (const row of rows) {
        cellsOf(row).forEach((cell, i) => {
          if (colOf[i]) cell.properties.dataCol = colOf[i];
          if (cell.tagName === "td" && /^not listed$/i.test(textOf(cell).trim())) cell.properties.dataEmpty = "true";
        });
      }
      for (const a of findAll(el, "a")) a.properties.dataVariant = "table-link";
    });
  };
}

function visit(node: Root | Element, fn: (el: Element) => void) {
  for (const child of node.children as (RootContent | ElementContent)[]) {
    if (child.type === "element") {
      fn(child);
      visit(child, fn);
    }
  }
}

function findAll(root: Element, tag: string): Element[] {
  const out: Element[] = [];
  visit(root, (el) => el.tagName === tag && out.push(el));
  return out;
}

function cellsOf(row: Element): Element[] {
  return row.children.filter(
    (c): c is Element => c.type === "element" && (c.tagName === "td" || c.tagName === "th"),
  );
}

function textOf(node: ElementContent | Element): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

// Each renderer drops `node` (the syntax-tree node react-markdown passes in)
// so it isn't spread onto the DOM element.
/* eslint-disable @typescript-eslint/no-unused-vars */
const components: Components = {
  p: ({ node, ...props }) =>
    node && /^filtered to:/i.test(textOf(node).trim()) ? (
      // The location line above results, shown as a badge.
      <p className="my-3 inline-flex items-center gap-1.5 rounded-full bg-navy-50 px-3 py-1 text-xs font-semibold text-navy ring-1 ring-navy-100 first:mt-0">
        <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
        {props.children}
      </p>
    ) : (
      <p className="my-2.5 first:mt-0 last:mb-0" {...props} />
    ),
  ul: ({ node, ...props }) => <ul className="my-2.5 list-disc space-y-1 pl-5 marker:text-brand" {...props} />,
  ol: ({ node, ...props }) => <ol className="my-2.5 list-decimal space-y-1 pl-5 marker:text-slate-400" {...props} />,
  strong: ({ node, ...props }) => <strong className="font-semibold text-navy" {...props} />,
  h1: ({ node, ...props }) => <h3 className="mt-5 mb-2 text-base font-bold text-navy first:mt-0" {...props} />,
  h2: ({ node, ...props }) => <h3 className="mt-5 mb-2 text-base font-bold text-navy first:mt-0" {...props} />,
  // Company names above each results table.
  h3: ({ node, ...props }) => (
    <h3
      className="mt-6 mb-2 flex items-center gap-2 text-[15px] font-bold text-navy first:mt-0 before:h-4 before:w-1 before:rounded-full before:bg-brand"
      {...props}
    />
  ),
  a: ({ node, children, ...props }) =>
    props["data-variant" as keyof typeof props] === "table-link" ? (
      <a
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-brand/40 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-600 transition hover:border-brand hover:bg-brand hover:text-white"
        {...props}
      >
        View posting <span aria-hidden="true">→</span>
      </a>
    ) : (
      <a
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-brand-600 underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
        {...props}
      >
        {children}
      </a>
    ),
  code: ({ node, ...props }) => (
    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-navy" {...props} />
  ),
  pre: ({ node, ...props }) => (
    <pre
      className="my-2.5 overflow-x-auto rounded-lg bg-slate-100 p-3 text-sm [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote className="my-2.5 border-l-4 border-brand/40 pl-3 text-slate-600" {...props} />
  ),
  hr: ({ node, ...props }) => <hr className="my-4 border-slate-200" {...props} />,
  // Scrolls sideways on narrow screens instead of widening the page.
  table: ({ node, ...props }) => (
    <div className="my-3">
      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full min-w-[34rem] border-collapse text-sm" {...props} />
      </div>
      <p className="mt-1 text-right text-[11px] text-slate-400 sm:hidden">Swipe for pay and link →</p>
    </div>
  ),
  thead: ({ node, ...props }) => <thead className="bg-navy text-white" {...props} />,
  tbody: ({ node, ...props }) => (
    <tbody className="[&>tr:nth-child(even)]:bg-slate-50 [&>tr]:transition-colors [&>tr:hover]:bg-brand-50" {...props} />
  ),
  tr: ({ node, ...props }) => <tr className="border-b border-slate-100 last:border-b-0" {...props} />,
  th: ({ node, ...props }) => (
    <th
      className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider data-[col=pay]:text-right data-[col=link]:text-right"
      {...props}
    />
  ),
  td: ({ node, ...props }) => (
    <td
      className="px-4 py-2.5 align-middle text-slate-700 data-[col=link]:text-right data-[col=pay]:whitespace-nowrap data-[col=pay]:text-right data-[col=pay]:not-data-[empty]:font-bold data-[col=pay]:not-data-[empty]:text-brand-600 data-[empty]:italic data-[empty]:text-slate-400"
      {...props}
    />
  ),
};
/* eslint-enable @typescript-eslint/no-unused-vars */

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeLedgerTables]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}
