import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sos: {
          red: "#d93025",
          dark: "#8f1d14",
        },
        safe: {
          green: "#188038",
        },
        zone: {
          danger: "#d93025",
          buffer: "#f29900",
          helper: "#188038",
          out: "#5f6368",
        },
        police: {
          navy: "#0f1e3c",
          steel: "#1c2e52",
        },
      },
      keyframes: {
        pulse_sos: {
          "0%, 100%": { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(217,48,37,0.5)" },
          "50%": { transform: "scale(1.04)", boxShadow: "0 0 0 24px rgba(217,48,37,0)" },
        },
      },
      animation: {
        pulse_sos: "pulse_sos 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
