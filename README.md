# Oenograph
Personal wine cellar tracker. Live at https://mrosantos.github.io/oenograph/

- `index.html` – the app
- `src/standalone.js` – accounts, cloud sync, photos, optional Claude key (bundled into `standalone.js` with `npx esbuild src/standalone.js --bundle --minify --format=iife --outfile=standalone.js`)
- `sw.js` – offline support and local photo serving
