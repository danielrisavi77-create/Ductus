import type { APIRequestContext } from "@playwright/test";

export const LOGIN_PORT: number;
export function loginOrigin(env?: NodeJS.ProcessEnv): string;
export function loginDevEntries(env?: NodeJS.ProcessEnv): { maxInactiveAge: number; pagesBufferLength: number } | undefined;
export function loginPagePaths(files: string[]): string[];
export function warmLoginPages(request: APIRequestContext, origin: string, paths: string[]): Promise<void>;
