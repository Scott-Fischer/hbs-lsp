const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
  const extensionRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(extensionRoot, '..');
  const targetServerRoot = path.join(extensionRoot, 'server');
  const targetDist = path.join(targetServerRoot, 'dist');
  const rootPackageJsonPath = path.join(repoRoot, 'package.json');
  const extensionPackageJsonPath = path.join(extensionRoot, 'package.json');
  const rootPackage = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'));
  const extensionPackage = JSON.parse(
    fs.readFileSync(extensionPackageJsonPath, 'utf8'),
  );

  fs.rmSync(targetServerRoot, { recursive: true, force: true });
  fs.mkdirSync(targetDist, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(repoRoot, 'src', 'server.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node20'],
    outfile: path.join(targetDist, 'server.js'),
    sourcemap: false,
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    logLevel: 'info',
  });

  const bundledServerPackage = {
    name: rootPackage.name,
    version: rootPackage.version,
    bundledInExtensionVersion: extensionPackage.version,
    type: 'module',
  };

  fs.writeFileSync(
    path.join(targetServerRoot, 'package.json'),
    `${JSON.stringify(bundledServerPackage, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
