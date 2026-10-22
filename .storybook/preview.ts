import type { Preview } from "@storybook/nextjs-vite";

import { fontVariables } from "../app/fonts";

import "../app/fonts/fonts.css";
import "../app/globals.css";

// Match the app's root: the token aliases in globals.css resolve on <html>.
document.documentElement.lang = "hr";
document.documentElement.classList.add(...fontVariables.split(" "));

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
  },
};

export default preview;
