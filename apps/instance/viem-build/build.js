const { build } = require('esbuild');
const path = require('path');

build({
  entryPoints: [path.join(__dirname, 'entry.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(__dirname, 'dist', 'viem-bundle.js'),
  minify: true,
  treeShaking: true,
  // Only bundle what we actually use
  external: [],
}).then(() => {
  console.log('[viem-build] Bundle created successfully');
}).catch((err) => {
  console.error('[viem-build] Build failed:', err);
  process.exit(1);
});
