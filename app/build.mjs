// Copies the website into www/ for the iPhone/iPad app, then into the Xcode project.
// Run with: npm run app
import {cpSync,rmSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execSync} from 'node:child_process';
const FILES=['index.html','standalone.js','lang.js','lang-es.js','lang-es-b.js','lang-it.js','lang-it-b.js','lang-fr.js','lang-fr-b.js',
  'manifest.webmanifest','icon-oe-192.png','icon-oe-512.png','touch-oe.png','fonts','app/native.css'];
execSync('npx esbuild src/standalone.js --bundle --minify --format=iife --outfile=standalone.js',{stdio:'inherit'});
rmSync('www',{recursive:true,force:true});mkdirSync('www');
for(const f of FILES)cpSync(f,'www/'+f.replace(/^app\//,''),{recursive:true});
cpSync('app/fonts','www/native-fonts',{recursive:true}); // the app's fonts as .ttf for the native Settings card
execSync('npx esbuild app/native.js --bundle --minify --format=iife --outfile=www/native.js',{stdio:'inherit'});
let html=readFileSync('www/index.html','utf8');
const at=html.indexOf('<script src="lang.js">');
if(at<0)throw new Error('index.html changed: could not find where to add native.js');
html=html.slice(0,at)+'<link rel="stylesheet" href="native.css"><script src="native.js"></script>'+html.slice(at);
writeFileSync('www/index.html',html);
if(existsSync('ios'))execSync('npx cap sync ios',{stdio:'inherit'});
