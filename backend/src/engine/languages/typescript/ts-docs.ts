import ts from "typescript";
import { scriptKindFor } from "./ts-metrics";

export interface DocCoverage {
  total: number;
  documented: number;
}

/**
 * Exported functions, classes, interfaces, type aliases, enums and function-valued
 * constants: a module's public API. Documented means it has a JSDoc block (`/** … *\/`).
 */
export function measureTsDocs(path: string, content: string): DocCoverage {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  let total = 0;
  let documented = 0;
  const count = (node: ts.Node) => {
    total++;
    if (ts.getJSDocCommentsAndTags(node).length > 0) documented++;
  };

  for (const statement of sf.statements) {
    if (!isExported(statement)) continue;
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      count(statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        const init = decl.initializer;
        // Only functions: exported plain values (config objects, constants) rarely need prose.
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) count(decl);
      }
    }
  }
  return { total, documented };
}

function isExported(node: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  );
}
