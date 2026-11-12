import ts from "typescript";
import type { AnalyzerContext } from "../../analyzers/analyzer";
import { familyOf } from "../../discovery/classify";
import type { SourceFile } from "../../discovery/source-file";
import { scriptKindFor } from "./ts-metrics";

export interface ModuleImport {
  /** As written: "./util", "react", "@scope/pkg/sub", "node:fs". */
  specifier: string;
  line: number;
  /** `import type` / `export type`: erased at compile time, so no runtime dependency. */
  typeOnly: boolean;
  /** `import()`: loaded lazily, so it cannot form a load-time cycle. */
  dynamic: boolean;
}

/** Every import, re-export, require() and import() in one TS/JS file. */
export function extractImports(path: string, content: string): ModuleImport[] {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const imports: ModuleImport[] = [];
  const add = (
    node: ts.Node,
    specifier: ts.Expression | undefined,
    typeOnly: boolean,
    dynamic: boolean,
  ) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    imports.push({ specifier: specifier.text, line, typeOnly, dynamic });
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      add(node, node.moduleSpecifier, node.importClause?.isTypeOnly ?? false, false);
    } else if (ts.isExportDeclaration(node)) {
      add(node, node.moduleSpecifier, node.isTypeOnly, false);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node, node.moduleReference.expression, node.isTypeOnly, false);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node, node.arguments[0], false, true);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        add(node, node.arguments[0], false, false);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return imports;
}

/** Imports of every readable TS/JS file in the scan, computed once and shared. */
export function tsImportsFor(ctx: AnalyzerContext): Promise<ReadonlyMap<string, ModuleImport[]>> {
  return ctx.memo("ts-imports", async () => {
    const files = ctx.discovery.files.filter(
      (f): f is SourceFile & { content: string } =>
        f.content !== null && familyOf(f.language) === "js",
    );
    return new Map(files.map((f) => [f.path, extractImports(f.path, f.content)]));
  });
}
