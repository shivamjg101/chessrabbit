import type { Config } from "tailwindcss";

// Glass on walnut.
//
// The app is a stack of frosted panes laid on a dark walnut desk, lit by a
// reading lamp. Depth comes from blur and from lamplight catching the edges of
// each pane, not from surfaces stepping darker or lighter.
//
// Three rules hold it together:
//
//   1. THE WARMTH LIVES BEHIND THE GLASS. The grain and the lamplight in
//      globals.css are where the colour is. Panes are lamplight at low alpha,
//      so the timber under them tints them. A pane that brings its own hue
//      fights the desk instead of letting it show through.
//   2. GREEN AND TERRACOTTA ARE SEMANTIC ONLY. Green (`accent`) means "right":
//      correct answer, best move, line retained. Terracotta (`bad`) means
//      "lost": blunder, forgotten, failed. Neither is ever used because a thing
//      needed colour.
//   3. BRASS IS THE ONLY DECORATIVE COLOUR. The primary action, focus, links,
//      tick marks, the inlay around the board. Copper only ever appears as the
//      far end of a brass gradient.
//
// Engine output is violet (`accent2`), so a suggestion is never mistaken for a
// verdict or for the user's own arrows.
//
// Every colour is a CSS variable holding bare RGB channels (see globals.css),
// so opacity modifiers like `bg-panel/60` keep working and the whole palette
// can be retuned in one place.
const rgb = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Fallback squares only. The real board colours come from
        // lib/boardTheme.ts, which the user can switch at runtime.
        board: {
          light: "#E4D9C4",
          dark: "#9A7550",
        },
        // Tints for glass, darkest to lightest. `night` is the desk under the
        // lamp; `panel`, `panelAlt` and `raise` are what a pane looks like
        // once the timber has been blurred through it. Deliberately not
        // called `base` - that would collide with the `text-base` utility.
        night: rgb("night"),
        panel: rgb("panel"),
        panelAlt: rgb("panel-alt"),
        raise: rgb("raise"),
        line: rgb("line"),
        // Text. Cream, then two steps of warm tan.
        ink: rgb("ink"),
        muted: rgb("muted"),
        faint: rgb("faint"),

        // The instrument colour. See rule 3 above.
        brass: rgb("brass"),
        brassLit: rgb("brass-lit"),
        gold: rgb("brass"),
        copper: rgb("copper"),

        // "Right." Correct answer, best move, line retained. Nothing else.
        accent: rgb("accent"),
        // "Lost." Blunder, forgotten, failed. Nothing else.
        bad: rgb("bad"),
        // Engine lines and arrows.
        accent2: rgb("accent2"),

        good: rgb("good"),
        warn: rgb("warn"),

        // The two piece colours, for anything that stands for a side away from
        // the board: player swatches, the eval bar, result badges.
        ivory: rgb("ivory"),
        ebony: rgb("ebony"),
      },
      fontFamily: {
        // The variables are supplied by next/font in layout.tsx; the literal
        // names stay as fallbacks so a locally-installed copy still applies.
        sans: ["var(--font-sans)", "Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
        // Display is the same grotesque at a heavier weight and tighter fit
        // (see `.font-display` in globals.css). One clean voice over the grain.
        display: ["var(--font-sans)", "Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
        // Algebraic notation is the app's second typeface, not a caption face.
        mono: ["var(--font-mono)", "IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      backdropBlur: {
        glass: "22px",
      },
      boxShadow: {
        glow: "0 4px 18px -2px rgb(var(--c-accent) / 0.45)",
        "glow-lg": "0 10px 34px -4px rgb(var(--c-accent) / 0.55)",
        // A pane lying on the desk: a wide soft drop plus a lit top edge.
        card: "inset 0 1px 0 rgb(var(--c-glint) / 0.14), 0 24px 60px -18px rgb(6 3 1 / 0.8)",
        // The board sits on its own plane, lifted well clear of the desk.
        board: "inset 0 1px 0 rgb(var(--c-glint) / 0.2), 0 40px 90px -24px rgb(6 3 1 / 0.9)",
        // 1px inner top highlight: lamplight catching the edge of the glass.
        edge: "inset 0 1px 0 rgb(var(--c-glint) / 0.12)",
        // The brass inlay between the bezel and the squares, and the shadow
        // the bezel casts onto the outer squares.
        frame:
          "inset 0 0 0 1px rgb(var(--c-brass) / 0.7), inset 0 0 8px rgb(6 3 1 / 0.35), 0 1px 0 rgb(6 3 1 / 0.5)",
        // A warm glow under the primary action, as if the brass caught the lamp.
        lamp: "0 10px 28px -8px rgb(var(--c-brass) / 0.55), inset 0 1px 0 rgb(255 245 225 / 0.6)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Opacity only, for anything that may hold a board: a transform,
        // even a finished one, would capture the board's drag layer.
        fade: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        pop: {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "60%": { opacity: "1", transform: "scale(1.12)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        rise: "rise 0.4s ease-out both",
        fade: "fade 0.2s ease-out both",
        pop: "pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
