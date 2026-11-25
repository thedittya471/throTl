import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        studio: {
          orange: "#FF5400",
          orangeHover: "#FF3D00",
          orangeGlow: "rgba(255, 84, 0, 0.35)",
          orangeSubtle: "rgba(255, 84, 0, 0.08)",
          card: "#0c0c10",
          cardElevated: "#121218",
          border: "rgba(255, 255, 255, 0.07)",
          borderLight: "rgba(255, 255, 255, 0.14)",
          borderOrange: "rgba(255, 84, 0, 0.45)",
        },
        carbon: {
          950: "#060608",
          900: "#0a0a0e",
          850: "#101015",
          800: "#181820",
          700: "#242430",
          600: "#38384a",
          500: "#525266",
          400: "#76768e",
          300: "#a3a3ba",
          200: "#d1d1e0",
          100: "#ededf5",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        mono: [
          '"SF Mono"',
          "Menlo",
          "Monaco",
          "Consolas",
          '"Liberation Mono"',
          "monospace",
        ],
      },
      letterSpacing: {
        tighter: "-0.04em",
        tight: "-0.02em",
        widest: "0.15em",
        mega: "0.25em",
      },
      animation: {
        "pulse-subtle": "pulseSubtle 2.5s ease-in-out infinite",
        "glow-orange": "glowOrange 2.5s ease-in-out infinite",
      },
      keyframes: {
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        glowOrange: {
          "0%, 100%": { boxShadow: "0 0 15px -3px rgba(255, 84, 0, 0.25)" },
          "50%": { boxShadow: "0 0 25px 2px rgba(255, 84, 0, 0.5)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
