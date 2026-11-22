# Oenograph
Personal wine cellar tracker. Live at https://mrosantos.github.io/oenograph/

- `index.html` – the app
- `src/standalone.js` – accounts, cloud sync, photos, optional Claude key (bundled into `standalone.js` with `npx esbuild src/standalone.js --bundle --minify --format=iife --outfile=standalone.js`)
- `sw.js` – offline support and local photo serving

## iPhone / iPad app
The App Store app wraps the same website with Capacitor.
- `app/build.mjs` (`npm run app`) – copies the site into `www/` and then into the Xcode project (`ios/`), adding `app/native.js`
- `app/native.js` – app-only fixes (bottle photos without a service worker)
- `ios/App/App.xcodeproj` – open this in Xcode on a Mac to build the app
- The site ignores `app/`, `ios/`, `www/` (see `.assetsignore`)
