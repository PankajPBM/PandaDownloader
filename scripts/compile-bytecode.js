const { app } = require('electron');
const bytenode = require('bytenode');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

// Silence default UI window
if (app) {
  app.commandLine.appendSwitch('disable-gpu');
}

async function main() {
  console.log('--------------------------------------------------');
  console.log(' Panda Downloader - V8 Bytecode & ASAR Encryption');
  console.log('--------------------------------------------------');

  const projectRoot = path.resolve(__dirname, '..');
  const releaseDir = path.join(projectRoot, 'release', 'PandaDownloader-win32-x64');
  const appDir = path.join(releaseDir, 'resources', 'app');
  const asarTarget = path.join(releaseDir, 'resources', 'app.asar');

  if (!fs.existsSync(appDir)) {
    console.error('Error: app directory does not exist at:', appDir);
    if (app) app.exit(1);
    process.exit(1);
  }

  // Files to compile into V8 bytecode (.jsc)
  const filesToCompile = [
    {
      source: path.join(appDir, 'src', 'main', 'main.js'),
      jsc: path.join(appDir, 'src', 'main', 'main.jsc'),
      stub: `'use strict';\nrequire('bytenode');\nrequire('./main.jsc');\n`
    },
    {
      source: path.join(appDir, 'src', 'main', 'licenseManager.js'),
      jsc: path.join(appDir, 'src', 'main', 'licenseManager.jsc'),
      stub: `'use strict';\nrequire('bytenode');\nmodule.exports = require('./licenseManager.jsc');\n`
    },
    {
      source: path.join(appDir, 'src', 'main', 'settings.js'),
      jsc: path.join(appDir, 'src', 'main', 'settings.jsc'),
      stub: `'use strict';\nrequire('bytenode');\nmodule.exports = require('./settings.jsc');\n`
    },
    {
      source: path.join(appDir, 'src', 'main', 'downloader', 'engine.js'),
      jsc: path.join(appDir, 'src', 'main', 'downloader', 'engine.jsc'),
      stub: `'use strict';\nrequire('bytenode');\nmodule.exports = require('./engine.jsc');\n`
    },
    {
      source: path.join(appDir, 'src', 'main', 'downloader', 'manager.js'),
      jsc: path.join(appDir, 'src', 'main', 'downloader', 'manager.jsc'),
      stub: `'use strict';\nrequire('bytenode');\nmodule.exports = require('./manager.jsc');\n`
    },
    {
      source: path.join(appDir, 'src', 'main', 'downloader', 'videoEngine.js'),
      jsc: path.join(appDir, 'src', 'main', 'downloader', 'videoEngine.jsc'),
      stub: `'use strict';\nrequire('bytenode');\nmodule.exports = require('./videoEngine.jsc');\n`
    },
    {
      source: path.join(appDir, 'src', 'main', 'native-host', 'host.js'),
      jsc: path.join(appDir, 'src', 'main', 'native-host', 'host.jsc'),
      stub: `'use strict';\nrequire('bytenode');\nmodule.exports = require('./host.jsc');\n`
    }
  ];

  console.log('[1/4] Compiling JavaScript into V8 machine bytecode...');
  for (const item of filesToCompile) {
    if (fs.existsSync(item.source)) {
      console.log(` -> Compiling: ${path.relative(appDir, item.source)}`);
      await bytenode.compileFile({
        filename: item.source,
        output: item.jsc,
        compileAsModule: true
      });

      // Replace source file with protective stub
      fs.writeFileSync(item.source, item.stub, 'utf-8');
      console.log(`    ✓ Protected with V8 bytecode: ${path.basename(item.jsc)}`);
    }
  }

  // Copy bytenode runtime into app's node_modules
  console.log('[2/4] Bundling bytenode runtime into package...');
  const appNodeModules = path.join(appDir, 'node_modules');
  const bytenodeSrc = path.join(projectRoot, 'node_modules', 'bytenode');
  const bytenodeDest = path.join(appNodeModules, 'bytenode');
  if (!fs.existsSync(appNodeModules)) {
    fs.mkdirSync(appNodeModules, { recursive: true });
  }
  if (fs.existsSync(bytenodeSrc)) {
    fs.cpSync(bytenodeSrc, bytenodeDest, { recursive: true, force: true });
    console.log('    ✓ bytenode runtime bundled successfully');
  }

  // Pack into app.asar
  console.log('[3/4] Creating encrypted ASAR archive (app.asar)...');
  if (fs.existsSync(asarTarget)) {
    fs.unlinkSync(asarTarget);
  }

  await asar.createPackage(appDir, asarTarget);
  console.log(`    ✓ ASAR archive created at: ${asarTarget}`);

  // Remove unencrypted plain app directory
  console.log('[4/4] Removing plaintext source directory...');
  fs.rmSync(appDir, { recursive: true, force: true });
  console.log('    ✓ Plaintext app directory removed. Only encrypted app.asar remains.');

  console.log('--------------------------------------------------');
  console.log(' V8 Bytecode & ASAR Encryption Complete! ');
  console.log('--------------------------------------------------');

  if (app) app.exit(0);
  process.exit(0);
}

if (app) {
  app.whenReady().then(main).catch(err => {
    console.error('Bytecode compilation failed:', err);
    app.exit(1);
  });
} else {
  main().catch(err => {
    console.error('Bytecode compilation failed:', err);
    process.exit(1);
  });
}
