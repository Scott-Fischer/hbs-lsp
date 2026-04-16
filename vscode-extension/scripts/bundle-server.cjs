const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const sourceDist = path.join(repoRoot, 'dist');
const targetServerRoot = path.join(extensionRoot, 'server');
const targetDist = path.join(targetServerRoot, 'dist');
const rootPackageJsonPath = path.join(repoRoot, 'package.json');

if (!fs.existsSync(sourceDist)) {
  throw new Error(`Expected built server output at ${sourceDist}. Run the root build first.`);
}

const rootPackage = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'));

fs.rmSync(targetServerRoot, { recursive: true, force: true });
fs.mkdirSync(targetServerRoot, { recursive: true });
fs.cpSync(sourceDist, targetDist, { recursive: true });

const bundledServerPackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  type: 'module',
};

fs.writeFileSync(
  path.join(targetServerRoot, 'package.json'),
  `${JSON.stringify(bundledServerPackage, null, 2)}\n`,
);
