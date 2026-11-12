/**
 * Languages with full analysis support. Any other text file is still checked by the
 * language-independent dimensions (integrity, secrets, duplication).
 */
export const LANGUAGES = ["typescript", "javascript", "python", "other"] as const;

export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_EXTENSIONS: Record<Exclude<Language, "other">, readonly string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py", ".pyi"],
};

export function languageFor(path: string): Language {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "other";
  const ext = path.slice(dot).toLowerCase();
  for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (extensions.includes(ext)) return language as Language;
  }
  return "other";
}
