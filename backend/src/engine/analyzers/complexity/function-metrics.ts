export interface FunctionMetrics {
  /** Qualified where possible, e.g. "UserService.save"; "<anonymous>" otherwise. */
  name: string;
  startLine: number;
  endLine: number;
  /** McCabe: 1 + number of decision points. How many paths need testing. */
  cyclomatic: number;
  /** SonarSource-style: control flow breaks, weighted by nesting. How hard it is to read. */
  cognitive: number;
  /** Deepest nesting of control structures inside the function body. */
  maxNesting: number;
}

export interface FileMetrics {
  path: string;
  functions: FunctionMetrics[];
  /** Set when the file could not be parsed; the correctness dimension reports the error. */
  parseError?: string;
}
