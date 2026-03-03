const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const LAMBDA_PACKAGES = ['watchtower', 'analyst', 'ghostwriter', 'gatekeeper', 'publisher'];

async function buildPackage(pkgName) {
  const pkgDir = path.join(__dirname, '..', 'packages', pkgName);
  const entryPoint = path.join(pkgDir, 'src', 'index.ts');
  const outDir = path.join(pkgDir, 'dist');

  if (!fs.existsSync(entryPoint)) {
    console.log(`Skipping ${pkgName}: no src/index.ts found`);
    return;
  }

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: path.join(outDir, 'index.js'),
    format: 'cjs',
    minify: false,
    sourcemap: true,
    external: [],
  });

  console.log(`Built ${pkgName}`);
}

async function main() {
  for (const pkg of LAMBDA_PACKAGES) {
    await buildPackage(pkg);
  }
  console.log('All Lambda packages built');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
