import ts from "typescript";
import type { FileMetrics, FunctionMetrics } from "../function-metrics";

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);
const LOGICAL_ASSIGNMENTS = new Set([
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isLogical(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind);
}

export function scriptKindFor(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/i.test(path)) return ts.ScriptKind.TS;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** Parses one TS/JS file (syntax only, no type checking) and measures each function. */
export function measureTsFile(path: string, content: string): FileMetrics {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  const firstError = diagnostics?.[0];

  const functions: FunctionMetrics[] = [];
  const visit = (node: ts.Node) => {
    if (isFunctionNode(node) && node.body) functions.push(measureFunction(node, sf));
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const result: FileMetrics = { path, functions };
  if (firstError) {
    result.parseError = ts.flattenDiagnosticMessageText(firstError.messageText, "\n");
  }
  return result;
}

function measureFunction(fn: FunctionNode, sf: ts.SourceFile): FunctionMetrics {
  const body = fn.body as ts.Node;
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  return {
    name: functionName(fn, sf),
    startLine: line(fn.getStart(sf)),
    endLine: line(fn.getEnd()),
    cyclomatic: cyclomatic(body),
    cognitive: cognitive(body),
    maxNesting: maxNesting(body),
  };
}

/** Visits children of `node`, never descending into nested functions (measured on their own). */
function eachChild(node: ts.Node, cb: (child: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    if (!isFunctionNode(child)) cb(child);
  });
}

function cyclomatic(body: ts.Node): number {
  let count = 1;
  const visit = (node: ts.Node) => {
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
        count++;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const op = (node as ts.BinaryExpression).operatorToken.kind;
        if (LOGICAL_OPERATORS.has(op) || LOGICAL_ASSIGNMENTS.has(op)) count++;
        break;
      }
    }
    eachChild(node, visit);
  };
  eachChild(body, visit);
  return count;
}

/**
 * Cognitive complexity after G. Ann Campbell (SonarSource, 2017):
 * +1 for each break in linear flow, plus the current nesting level for structures
 * that nest; `else if` and `else` add 1 without a nesting penalty; each run of
 * identical logical operators adds 1 (`a && b && c` is 1, `a && b || c` is 2).
 */
function cognitive(body: ts.Node): number {
  let total = 0;

  const visit = (node: ts.Node, nesting: number): void => {
    if (isFunctionNode(node)) return;
    if (ts.isIfStatement(node)) {
      visitIf(node, nesting, false);
      return;
    }
    if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isConditionalExpression(node)
    ) {
      total += 1 + nesting;
      eachChild(node, (c) => visit(c, nesting + 1));
      return;
    }
    if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) {
      total += 1;
      return;
    }
    if (isLogical(node)) {
      const { operators, operands } = flattenLogical(node);
      total += countRuns(operators);
      for (const operand of operands) visit(operand, nesting);
      return;
    }
    eachChild(node, (c) => visit(c, nesting));
  };

  const visitIf = (node: ts.IfStatement, nesting: number, isElseIf: boolean): void => {
    total += isElseIf ? 1 : 1 + nesting;
    visit(node.expression, nesting);
    visit(node.thenStatement, nesting + 1);
    const elseBranch = node.elseStatement;
    if (!elseBranch) return;
    if (ts.isIfStatement(elseBranch)) {
      visitIf(elseBranch, nesting, true);
    } else {
      total += 1;
      visit(elseBranch, nesting + 1);
    }
  };

  eachChild(body, (c) => visit(c, 0));
  return total;
}

/** In-order operators and non-logical operands of a chain like `a && (b || c) ?? d`. */
function flattenLogical(node: ts.Node): { operators: ts.SyntaxKind[]; operands: ts.Node[] } {
  const operators: ts.SyntaxKind[] = [];
  const operands: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    const inner = ts.isParenthesizedExpression(n) ? n.expression : n;
    if (isLogical(inner)) {
      walk(inner.left);
      operators.push(inner.operatorToken.kind);
      walk(inner.right);
    } else {
      operands.push(n);
    }
  };
  walk(node);
  return { operators, operands };
}

function countRuns(items: readonly unknown[]): number {
  let runs = 0;
  items.forEach((item, i) => {
    if (i === 0 || item !== items[i - 1]) runs++;
  });
  return runs;
}

function maxNesting(body: ts.Node): number {
  let max = 0;
  const visit = (node: ts.Node, depth: number): void => {
    if (isFunctionNode(node)) return;
    if (ts.isIfStatement(node)) {
      const d = depth + 1;
      max = Math.max(max, d);
      visit(node.expression, depth);
      visit(node.thenStatement, d);
      // `else if` sits at the same depth as its `if`.
      if (node.elseStatement) {
        if (ts.isIfStatement(node.elseStatement)) visit(node.elseStatement, depth);
        else visit(node.elseStatement, d);
      }
      return;
    }
    if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isTryStatement(node)
    ) {
      const d = depth + 1;
      max = Math.max(max, d);
      eachChild(node, (c) => visit(c, d));
      return;
    }
    eachChild(node, (c) => visit(c, depth));
  };
  eachChild(body, (c) => visit(c, 0));
  return max;
}

function functionName(fn: FunctionNode, sf: ts.SourceFile): string {
  let own: string | undefined;
  if (ts.isConstructorDeclaration(fn)) own = "constructor";
  else if (fn.name) own = fn.name.getText(sf);
  else {
    const parent = fn.parent;
    if (
      (ts.isVariableDeclaration(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isPropertyDeclaration(parent)) &&
      parent.name
    ) {
      own = parent.name.getText(sf);
    } else if (ts.isExportAssignment(parent)) {
      own = "default";
    }
  }

  const owner = enclosingClassName(fn, sf);
  const name = own ?? "<anonymous>";
  return owner ? `${owner}.${name}` : name;
}

function enclosingClassName(node: ts.Node, sf: ts.SourceFile): string | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (isFunctionNode(p)) return undefined;
    if ((ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name) return p.name.getText(sf);
  }
  return undefined;
}
