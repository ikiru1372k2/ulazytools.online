import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        mist: "#f8fafc",
        signal: "#0f766e",
        flare: "#f59e0b",
      },
    },
  },
  plugins: [],
};

export default config;
