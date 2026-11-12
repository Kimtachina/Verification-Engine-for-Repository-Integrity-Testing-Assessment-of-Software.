"""Measure Python functions for VERITAS.

Reads {"files": [{"path": str, "content": str}]} on stdin and writes
{"files": [{"path", "functions": [...]} | {"path", "parseError"}]} on stdout.

Only `ast.parse` is used: the code under inspection is parsed, never imported or run.
Metric definitions match ts-metrics.ts so scores are comparable across languages.
"""

import ast
import json
import sys

FUNCTION_TYPES = (ast.FunctionDef, ast.AsyncFunctionDef)
SCOPE_TYPES = FUNCTION_TYPES + (ast.ClassDef,)
LOOP_TYPES = (ast.For, ast.AsyncFor, ast.While)
# Newer syntax is looked up dynamically so the script runs on older Pythons too.
MATCH = getattr(ast, "Match", None)
TRY_TYPES = tuple(t for t in (ast.Try, getattr(ast, "TryStar", None)) if t is not None)
NESTING_TYPES = (ast.If, ast.With, ast.AsyncWith) + LOOP_TYPES + TRY_TYPES + (
    (MATCH,) if MATCH else ()
)


def children(node):
    """Child nodes, skipping nested functions and classes (measured on their own)."""
    return [c for c in ast.iter_child_nodes(node) if not isinstance(c, SCOPE_TYPES)]


def body_nodes(fn):
    """The function body, excluding decorators, defaults and annotations."""
    return [s for s in fn.body if not isinstance(s, SCOPE_TYPES)]


def is_wildcard_case(case):
    pattern = case.pattern
    return isinstance(pattern, ast.MatchAs) and pattern.pattern is None and case.guard is None


def cyclomatic(fn):
    count = 1
    stack = body_nodes(fn)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.If, ast.IfExp, ast.ExceptHandler) + LOOP_TYPES):
            count += 1
        elif isinstance(node, ast.BoolOp):
            count += len(node.values) - 1
        elif isinstance(node, ast.comprehension):
            count += 1 + len(node.ifs)
        elif MATCH and isinstance(node, ast.match_case) and not is_wildcard_case(node):
            count += 1
        stack.extend(children(node))
    return count


def cognitive(fn):
    total = 0

    def visit(node, nesting):
        nonlocal total
        if isinstance(node, SCOPE_TYPES):
            return
        if isinstance(node, ast.If):
            visit_if(node, nesting, False)
        elif isinstance(node, LOOP_TYPES):
            total += 1 + nesting
            for c in children(node):
                visit(c, nesting + 1)
            if node.orelse:
                total += 1
        elif isinstance(node, TRY_TYPES):
            for s in node.body + node.orelse + node.finalbody:
                visit(s, nesting)
            for handler in node.handlers:
                total += 1 + nesting
                for s in handler.body:
                    visit(s, nesting + 1)
        elif (MATCH and isinstance(node, MATCH)) or isinstance(node, ast.IfExp):
            total += 1 + nesting
            for c in children(node):
                visit(c, nesting + 1)
        elif isinstance(node, ast.BoolOp):
            # Python groups identical operators already: `a and b and c` is one BoolOp.
            total += 1
            for c in children(node):
                visit(c, nesting)
        elif isinstance(node, ast.comprehension):
            total += 1 + len(node.ifs)
            for c in children(node):
                visit(c, nesting)
        elif isinstance(node, ast.Lambda):
            visit(node.body, nesting + 1)
        else:
            for c in children(node):
                visit(c, nesting)

    def visit_if(node, nesting, is_elif):
        nonlocal total
        total += 1 if is_elif else 1 + nesting
        visit(node.test, nesting)
        for s in node.body:
            visit(s, nesting + 1)
        if not node.orelse:
            return
        if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
            visit_if(node.orelse[0], nesting, True)
        else:
            total += 1
            for s in node.orelse:
                visit(s, nesting + 1)

    for stmt in body_nodes(fn):
        visit(stmt, 0)
    return total


def max_nesting(fn):
    deepest = 0

    def visit(node, depth):
        nonlocal deepest
        if isinstance(node, SCOPE_TYPES):
            return
        if isinstance(node, ast.If):
            d = depth + 1
            deepest = max(deepest, d)
            visit(node.test, depth)
            for s in node.body:
                visit(s, d)
            # `elif` sits at the same depth as its `if`.
            if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
                visit(node.orelse[0], depth)
            else:
                for s in node.orelse:
                    visit(s, d)
        elif isinstance(node, NESTING_TYPES):
            d = depth + 1
            deepest = max(deepest, d)
            for c in children(node):
                visit(c, d)
        else:
            for c in children(node):
                visit(c, depth)

    for stmt in body_nodes(fn):
        visit(stmt, 0)
    return deepest


def collect(node, scope, out):
    for child in ast.iter_child_nodes(node):
        if isinstance(child, FUNCTION_TYPES):
            start = min([child.lineno] + [d.lineno for d in child.decorator_list])
            out.append(
                {
                    "name": ".".join(scope + [child.name]),
                    "startLine": start,
                    "endLine": child.end_lineno or child.lineno,
                    "cyclomatic": cyclomatic(child),
                    "cognitive": cognitive(child),
                    "maxNesting": max_nesting(child),
                }
            )
            collect(child, scope + [child.name], out)
        elif isinstance(child, ast.ClassDef):
            collect(child, scope + [child.name], out)
        else:
            collect(child, scope, out)


def measure(path, content):
    try:
        tree = ast.parse(content, filename=path)
        functions = []
        collect(tree, [], functions)
        return {"path": path, "functions": functions}
    except (SyntaxError, ValueError) as error:
        return {"path": path, "functions": [], "parseError": f"{type(error).__name__}: {error}"}
    except RecursionError:
        return {"path": path, "functions": [], "parseError": "Nesting too deep to parse"}


def main():
    request = json.load(sys.stdin)
    results = [measure(f["path"], f["content"]) for f in request["files"]]
    json.dump({"files": results}, sys.stdout)


if __name__ == "__main__":
    main()
