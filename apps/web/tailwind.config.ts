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
        cockpit: {
          950: "#050811",
          900: "#0a0f1d",
          850: "#0f172a",
          800: "#1e293b",
          700: "#334155",
        },
        cyber: {
          cyan: "#06b6d4",
          emerald: "#10b981",
          violet: "#8b5cf6",
          amber: "#f59e0b",
          rose: "#f43f5e",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "glow-cyan": "glowCyan 3s ease-in-out infinite",
        "glow-emerald": "glowEmerald 3s ease-in-out infinite",
        "shimmer": "shimmer 2.5s linear infinite",
      },
      keyframes: {
        glowCyan: {
          "0%, 100%": { boxShadow: "0 0 15px -3px rgba(6, 182, 212, 0.3)" },
          "50%": { boxShadow: "0 0 25px 2px rgba(6, 182, 212, 0.6)" },
        },
        glowEmerald: {
          "0%, 100%": { boxShadow: "0 0 15px -3px rgba(16, 185, 129, 0.3)" },
          "50%": { boxShadow: "0 0 25px 2px rgba(16, 185, 129, 0.6)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
