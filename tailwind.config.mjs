/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#020617",
        surface: "#020617",
        emerald: {
          400: "#34d399",
          500: "#22c55e",
          700: "#047857",
        },
      },
    },
  },
  plugins: [],
};

export default config;

