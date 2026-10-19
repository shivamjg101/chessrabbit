import type { Config } from "tailwindcss";

// Light oak surfaces with walnut controls. Keep the established token names as
// compatibility aliases for the many Tailwind utilities already in the app.
// `ivory` and `ebony` still describe the chess sides, not UI surfaces.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Fallback squares only; selectable board colours live in boardTheme.ts.
        board: {
          light: "#E4D9C4",
          dark: "#9A7550",
        },
        night: "#EBD9BC",
        panel: "#FFF8EA",
        panelAlt: "#F3E4CC",
        raise: "#E8D1AE",
        line: "#B58C61",
        ink: "#302318",
        muted: "#604B39",
        faint: "#6B523B",
        brass: "#7B4721",
        brassLit: "#6D3F1D",
        gold: "#7B4721",
        accent: "#286047",
        bad: "#A0352A",
        accent2: "#643FA5",
        good: "#326747",
        warn: "#855016",
        ivory: "#F8F1E3",
        ebony: "#302318",
      },
      fontFamily: {
        // The variables are supplied by next/font in layout.tsx; the literal
        // names stay as fallbacks so a locally-installed copy still applies.
        sans: ["var(--font-sans)", "Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Instrument Serif", "ui-serif", "Georgia", "serif"],
        // Algebraic notation is the app's third typeface, not a caption face.
        mono: ["var(--font-mono)", "IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 2px 12px rgba(40, 96, 71, 0.2)",
        "glow-lg": "0 6px 26px rgba(40, 96, 71, 0.3)",
        card: "0 12px 36px rgba(77, 47, 24, 0.16)",
        board: "0 20px 42px rgba(69, 39, 18, 0.3)",
        edge: "inset 0 1px 0 rgba(255, 252, 243, 0.75)",
        frame: "inset 0 0 0 1px rgba(68, 38, 19, 0.8), 0 1px 2px rgba(53, 31, 17, 0.45)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pop: {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "60%": { opacity: "1", transform: "scale(1.12)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        rise: "rise 0.4s ease-out both",
        pop: "pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
