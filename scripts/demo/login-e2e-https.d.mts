import type { APIRequestContext } from "@playwright/test";

export const LOGIN_PORT: number;
export function loginOrigin(env?: NodeJS.ProcessEnv): string;
export function loginPagePaths(files: string[]): string[];
export function warmLoginPages(request: APIRequestContext, origin: string, paths: string[]): Promise<void>;
