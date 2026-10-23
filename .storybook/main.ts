import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  framework: "@storybook/nextjs-vite",
  core: {
    disableTelemetry: true,
    enableCrashReports: false,
  },
};

export default config;
