// Types for check-procedures.mjs, for the vitest tests (allowJs is off).

export interface Step {
  number: number;
  line: number;
  text: string;
  /** The line is outside the subset; it is reported once as unsupported. */
  refused?: boolean;
}

export interface Procedure {
  name: string;
  line: number;
  steps: Step[];
}

export interface Operations {
  owners: { name: string; line: number }[];
  procedures: Procedure[];
  proceduresLine: number | null;
  /** Lines in Nositelji and Postupci (and fences, HTML, headings anywhere) outside the strict line subset. */
  unsupported: Problem[];
}

export interface Problem {
  procedure: string;
  step: number | null;
  line: number;
  message: string;
}

export interface Context {
  scripts: Set<string>;
  fileExists: (path: string) => boolean;
  routeExists: (route: string) => boolean;
}

export const REQUIRED_PROCEDURES: readonly string[];

export function parseOperations(text: string): Operations;

export function checkOperations(text: string, context: Context): Problem[];

export function repoContext(root: URL): Context;
