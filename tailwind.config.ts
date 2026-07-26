import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        accent: {
          50: "#F0F7F1",
          100: "#DFEEE2",
          200: "#BFDEC7",
          300: "#94C7A3",
          400: "#5CA974",
          500: "#348D51",
          600: "#1E7340",
          700: "#195F36",
          800: "#154E2D",
          900: "#114026",
          950: "#0A2B19",
        },
        ink: "#0D1B12",
        paper: "#F7F6F2",
        stripe: {
          violet: "#9d5cf6",
          blue: "#4353ff",
          coral: "#f8717e",
          salmon: "#fda374",
        },
      },
      backgroundImage: {
        "grid-light":
          "linear-gradient(rgba(13,27,18,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(13,27,18,0.05) 1px, transparent 1px)",
        "cta-gradient": "linear-gradient(135deg, #1E7340, #3FA65B)",
      },
      backgroundSize: {
        grid: "44px 44px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(13,27,18,0.05)",
        elevated:
          "0 2px 8px rgba(13,27,18,0.06), 0 16px 40px -12px rgba(13,27,18,0.10)",
        glow: "0 0 0 1px rgba(30,115,64,0.16), 0 8px 24px -4px rgba(30,115,64,0.28)",
        "glow-lg":
          "0 0 0 1px rgba(30,115,64,0.20), 0 14px 40px -6px rgba(30,115,64,0.32)",
        "ring-soft": "0 0 0 4px rgba(30,115,64,0.10)",
      },
      animation: {
        "fade-in": "fade-in 0.6s ease-out both",
        "slide-up": "slide-up 0.6s ease-out both",
        "pulse-soft": "pulse-soft 3s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        "draw-line": "draw-line 1.6s ease-out forwards",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "draw-line": {
          from: { strokeDashoffset: "1000" },
          to: { strokeDashoffset: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
