/** @type {import('postcss-load-config').Config} */
// Tailwind v4 split the PostCSS plugin into a separate package
// (@tailwindcss/postcss); using `tailwindcss` directly raises
// "tailwindcss directly as a PostCSS plugin… has moved".
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};

export default config;
