/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F8F5EF",
        cream: "#FFFCF7",
        charcoal: "#202124",
        muted: "#6F6A7A",
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        violetSoft: "rgb(var(--color-primary-soft) / <alpha-value>)",
        emerald: "#119C78",
        emeraldSoft: "#E3F7EF",
        coral: "#E95C57",
        coralSoft: "#FFE9E4",
        income: "#2F7DE1",
        incomeSoft: "#E5F0FF",
        amber: "#D79A16",
        amberSoft: "#FFF3D3"
      },
      boxShadow: {
        soft: "0 14px 40px rgba(67, 54, 94, 0.12)",
        card: "0 8px 24px rgba(38, 31, 52, 0.08)"
      },
      borderRadius: {
        "2xl": "1.25rem",
        "3xl": "1.5rem"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
