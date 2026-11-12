// Bundles the game into dist/ (static site) and dist/artifact.html (page fragment for hosted previews).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, minify: !process.argv.includes('--dev'), format: 'iife', target: ['es2020'], loader: { '.json': 'json' },
  outfile: path.join(dist, 'app.js'), legalComments: 'none', logLevel: 'info',
});

const css = fs.readFileSync(path.join(root, 'src/styles/tokens.css'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/styles/app.css'), 'utf8');
const body = fs.readFileSync(path.join(root, 'src/body.html'), 'utf8');
const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600&family=Barlow+Condensed:wght@500;700&family=Metal+Mania&family=Black+Ops+One&family=Orbitron:wght@700;900&display=swap">';
const head = `<title>Riffgewitter</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>\n${css}\n</style>`;

// page fragment (the host wraps it in its own document skeleton)
fs.writeFileSync(path.join(dist, 'artifact.html'), `${head}\n${body}\n<script src="app.js"></script>\n`);

// standalone document
fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#07060a">
<meta name="description" content="Riffgewitter, Rotorsturm, Erdabwehr: 3D-Flipper / 3D pinball by Echomotion">
<meta name="author" content="Echomotion GmbH">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);box-sizing:border-box;height:100%}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
<script src="app.js"></script>
</body>
</html>
`);
fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), JSON.stringify({
  name: 'Riffgewitter', short_name: 'Riffgewitter', description: 'Hard Rock Flipper / Hard Rock Pinball',
  start_url: './', display: 'fullscreen', orientation: 'any', background_color: '#07060a', theme_color: '#07060a',
  icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 2));
fs.writeFileSync(path.join(dist, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#07060a"/><path d="M36 4 14 36h14l-6 24 28-34H35z" fill="#ff5a1f" stroke="#ffb347" stroke-width="2" stroke-linejoin="round"/></svg>`);
const TABLE_IDS = ['riff', 'rotor', 'alien'];
for (const old of ['assets/table.glb', 'assets/playfield_base.jpg', 'assets-inline.js']) fs.rmSync(path.join(dist, old), { force: true });
const inlineParts = [];
for (const id of TABLE_IDS) {
  fs.mkdirSync(path.join(dist, 'assets', id), { recursive: true });
  const have = ['table.glb', 'playfield_base.jpg'].every((f) => fs.existsSync(path.join(root, 'assets', id, f)));
  if (!have) { console.warn('missing assets for table', id); continue; }
  for (const f of ['table.glb', 'playfield_base.jpg']) fs.copyFileSync(path.join(root, 'assets', id, f), path.join(dist, 'assets', id, f));
  const b64 = (f) => fs.readFileSync(path.join(root, 'assets', id, f)).toString('base64');
  const artKeys = { scene: 'art_scene.webp', apron: 'art_apron.webp', soldierL: 'art_soldier_left.webp', soldierR: 'art_soldier_right.webp' };
  const art = [];
  for (const [k, f] of Object.entries(artKeys)) {
    if (!fs.existsSync(path.join(root, 'assets', id, f))) continue;
    fs.copyFileSync(path.join(root, 'assets', id, f), path.join(dist, 'assets', id, f));
    art.push(`${k}:"data:image/webp;base64,${b64(f)}"`);
  }
  const part = `${JSON.stringify(id)}:{glb:"data:model/gltf-binary;base64,${b64('table.glb')}",base:"data:image/jpeg;base64,${b64('playfield_base.jpg')}",art:{${art.join(',')}}}`;
  // per-table script: fallback for hosts that cannot serve .glb files
  fs.writeFileSync(path.join(dist, `assets-inline-${id}.js`), `window.__RG_ASSETS_ALL=Object.assign(window.__RG_ASSETS_ALL||{},{${part}});`);
  inlineParts.push(part);
}
// single self-contained file with both tables (works offline by double-click, easy to send as a gift)
if (inlineParts.length) {
  const js = fs.readFileSync(path.join(dist, 'app.js'), 'utf8').replace(/<\/script/g, '<\\/script');
  const assets = `window.__RG_ASSETS_ALL={${inlineParts.join(',')}};`;
  fs.writeFileSync(path.join(dist, 'riffgewitter-standalone.html'), `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#07060a">
<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);box-sizing:border-box;height:100%}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
<script>${assets}</script>
<script>${js}</script>
</body>
</html>
`);
}
// the owner's songs (optional): streamed from music/ when present
{
  const msrc = path.join(root, 'assets/music');
  if (fs.existsSync(msrc)) {
    fs.mkdirSync(path.join(dist, 'music'), { recursive: true });
    for (const f of fs.readdirSync(msrc)) if (f.endsWith('.mp3')) fs.copyFileSync(path.join(msrc, f), path.join(dist, 'music', f));
  }
}
fs.writeFileSync(path.join(dist, 'netlify.toml'), `[build]
  publish = "."
  command = "echo static site"

[[headers]]
  for = "/music/*"
  [headers.values]
    Cache-Control = "public, max-age=604800"
`);
const kb = (f) => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' kB';
console.log('dist ready:', 'app.js', kb('app.js'), ...TABLE_IDS.filter((id) => fs.existsSync(path.join(dist, `assets/${id}/table.glb`))).map((id) => `| ${id} ${kb(`assets/${id}/table.glb`)}`), '| standalone', kb('riffgewitter-standalone.html'));
