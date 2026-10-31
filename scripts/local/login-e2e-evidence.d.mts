export function evidenceServerEnvironment(
  source?: NodeJS.ProcessEnv,
  run?: (env: NodeJS.ProcessEnv) => { status: number | null; stdout: string },
): Record<string, string>;
