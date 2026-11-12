/**
 * The offending code with real line numbers. Plain text, never HTML: snippets come from
 * the scanned code and must not be interpreted by the browser.
 */
export function CodeSnippet({ code, startLine }: { code: string; startLine?: number }) {
  const lines = code.split("\n");
  const first = startLine ?? 1;
  const width = String(first + lines.length - 1).length;
  return (
    <figure className="overflow-hidden rounded-xl border bg-muted/40">
      <pre className="overflow-x-auto py-3 font-mono text-[13px] leading-6">
        <code>
          {lines.map((line, i) => (
            // Lines are positional and never reorder.
            // biome-ignore lint/suspicious/noArrayIndexKey: index is the line's identity
            <span key={i} className="flex">
              {startLine !== undefined && (
                <span
                  className="sticky left-0 shrink-0 select-none bg-muted/80 pr-4 pl-4 text-right text-muted-foreground tabular-nums"
                  style={{ minWidth: `${width + 3}ch` }}
                  aria-hidden
                >
                  {first + i}
                </span>
              )}
              <span className="pr-4 pl-3 whitespace-pre">{line || " "}</span>
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
