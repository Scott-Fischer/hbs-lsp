const esbuild = require('esbuild');

async function main() {
  await esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node20'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
    sourcemap: false,
    logLevel: 'info',
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
