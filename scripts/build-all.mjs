import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { request as httpRequest } from 'http';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function preadFile(filePath, encoding = null) {
  const fd = openSync(filePath, 'r');
  try {
    const stat = fstatSync(fd);
    const buf = Buffer.allocUnsafe(stat.size);
    let total = 0;
    while (total < stat.size) {
      const r = readSync(fd, buf, total, stat.size - total, total);
      if (r <= 0) break;
      total += r;
    }
    const sliced = buf.subarray(0, total);
    return encoding ? sliced.toString(encoding) : sliced;
  } finally {
    closeSync(fd);
  }
}

// Ensure uncompressed esbuild binary in /tmp/esbuild-bin
const esbuildBinSrc = join(rootDir, 'node_modules/@esbuild/darwin-arm64/bin/esbuild');
const esbuildBinTmp = '/tmp/esbuild-bin';
if (existsSync(esbuildBinSrc)) {
  writeFileSync(esbuildBinTmp, preadFile(esbuildBinSrc), { mode: 0o755 });
  process.env.ESBUILD_BINARY_PATH = esbuildBinTmp;
}

function compileTsFile(relInput, relOutput) {
  const inPath = join(rootDir, relInput);
  const outPath = join(rootDir, relOutput);
  mkdirSync(dirname(outPath), { recursive: true });
  const source = preadFile(inPath, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
    },
    fileName: inPath,
  });
  writeFileSync(outPath, result.outputText, 'utf8');
  console.log(`Compiled ${relInput} -> ${relOutput}`);
}

function computeFileIntegrity(buf) {
  const BLOCK_SIZE = 4 * 1024 * 1024;
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    const slice = buf.subarray(i, Math.min(i + BLOCK_SIZE, buf.length));
    blocks.push(createHash('sha256').update(slice).digest('hex'));
  }
  if (blocks.length === 0) {
    blocks.push(createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  }
  return {
    algorithm: 'SHA256',
    hash: createHash('sha256').update(buf).digest('hex'),
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

function patchAsarBuffer(asarBuf, fileMap) {
  const headerPayloadSize = asarBuf.readUInt32LE(4);
  const jsonByteLen = asarBuf.readUInt32LE(12);
  const jsonStr = asarBuf.subarray(16, 16 + jsonByteLen).toString('utf8');
  const tree = JSON.parse(jsonStr);
  const dataOffset = 8 + headerPayloadSize;
  const origPayload = asarBuf.subarray(dataOffset);

  const extraBuffers = [];
  let currentOffset = origPayload.length;

  for (const [relPath, contentBuf] of Object.entries(fileMap)) {
    const parts = relPath.split('/');
    let cursor = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cursor.files) cursor.files = {};
      if (!cursor.files[part]) cursor.files[part] = { files: {} };
      cursor = cursor.files[part];
    }
    const fileName = parts[parts.length - 1];
    if (!cursor.files) cursor.files = {};
    cursor.files[fileName] = {
      size: contentBuf.length,
      offset: String(currentOffset),
      integrity: computeFileIntegrity(contentBuf),
    };
    extraBuffers.push(contentBuf);
    currentOffset += contentBuf.length;
  }

  const newJsonStr = JSON.stringify(tree);
  const newJsonBuf = Buffer.from(newJsonStr, 'utf8');
  const alignPadding = (4 - (newJsonBuf.length % 4)) % 4;
  const alignedJsonLen = newJsonBuf.length + alignPadding;
  const newHeaderPayloadSize = alignedJsonLen + 8;

  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(newHeaderPayloadSize, 4);
  prefix.writeUInt32LE(alignedJsonLen + 4, 8);
  prefix.writeUInt32LE(newJsonBuf.length, 12);

  const padBuf = Buffer.alloc(alignPadding);
  const newAsarBuf = Buffer.concat([prefix, newJsonBuf, padBuf, origPayload, ...extraBuffers]);
  const newHeaderHash = createHash('sha256').update(newJsonBuf).digest('hex');

  return { newAsarBuf, newHeaderHash };
}

function updateInfoPlistHash(plistPath, newHash) {
  if (!existsSync(plistPath)) return;
  try {
    let xml = preadFile(plistPath, 'utf8');
    xml = xml.replace(
      /(<key>Resources\/app\.asar<\/key>\s*<dict>\s*<key>algorithm<\/key>\s*<string>SHA256<\/string>\s*<key>hash<\/key>\s*<string>)[0-9a-fA-F]+(<\/string>)/,
      `$1${newHash}$2`
    );
    const appContentsDir = dirname(plistPath);
    const hasToobarHelper = existsSync(
      join(appContentsDir, 'Frameworks/Toobar Helper.app')
    );
    if (hasToobarHelper) {
      xml = xml.replace(
        /(<key>CFBundleName<\/key>\s*<string>)[^<]+(<\/string>)/,
        `$1Toobar$2`
      );
      xml = xml.replace(
        /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/,
        `$1Toobar$2`
      );
    }
    if (!xml.includes('<string>toobar</string>')) {
      const urlTypesBlock = `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>Toobar Meeting Link</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>toobar</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n</dict>`;
      xml = xml.replace(/<\/dict>\s*<\/plist>\s*$/, `${urlTypesBlock}\n</plist>\n`);
    }
    writeFileSync(plistPath, xml, 'utf8');
  } catch (err) {
    console.warn(`Failed to update plist ${plistPath}: ${err.message}`);
  }
}

async function updatePackagedAsar() {
  // Only hot-patch macOS Toobar.app if it is already a genuine Toobar.app bundle.
  // Never cross-copy macOS app.asar onto Windows/Linux builds; use electron-builder for clean OS builds.
  const macToobarApp = join(rootDir, 'dist-electron/mac-arm64/Toobar.app');
  const baseAsar = join(macToobarApp, 'Contents/Resources/app.asar');
  if (!existsSync(baseAsar) || !existsSync(join(macToobarApp, 'Contents/MacOS/Toobar'))) {
    return;
  }

  const filesToUpdate = [
    'dist/shared/types.js',
    'dist/main/index.js',
    'dist/main/preload.js',
    'dist/signaling/server.js',
    'dist/renderer/index.html',
    'dist/renderer/assets/main.js',
    'dist/renderer/assets/main.css',
    'dist/update-manifest.json',
    'dist/update-bundle.json',
    'public/icon.png',
    'public/icon.ico',
    'public/icon.svg',
    'public/tray-icon.png',
    'package.json',
  ];

  const fileMap = {};
  for (const rel of filesToUpdate) {
    const full = join(rootDir, rel);
    if (existsSync(full)) {
      fileMap[rel] = preadFile(full);
    }
  }

  console.log('Patching macOS Toobar.app app.asar with latest dist & shared modules...');
  const origAsar = preadFile(baseAsar);
  const { newAsarBuf, newHeaderHash } = patchAsarBuffer(origAsar, fileMap);

  writeFileSync(baseAsar, newAsarBuf);
  updateInfoPlistHash(join(macToobarApp, 'Contents/Info.plist'), newHeaderHash);

  if (existsSync('/Applications/Toobar.app/Contents/MacOS/Toobar')) {
    try {
      writeFileSync('/Applications/Toobar.app/Contents/Resources/app.asar', newAsarBuf);
      updateInfoPlistHash('/Applications/Toobar.app/Contents/Info.plist', newHeaderHash);
      console.log('Updated /Applications/Toobar.app/Contents/Resources/app.asar');
    } catch (err) {
      console.warn(`Skipped /Applications/Toobar.app: ${err.message}`);
    }
  }
}

function generateOtaUpdateBundle() {
  const pkgJson = JSON.parse(preadFile(join(rootDir, 'package.json'), 'utf8'));
  const version = pkgJson.version || '1.0.0';

  const bundleRelFiles = [
    'dist/shared/types.js',
    'dist/main/index.js',
    'dist/main/preload.js',
    'dist/signaling/server.js',
    'dist/renderer/index.html',
    'dist/renderer/assets/main.js',
    'dist/renderer/assets/main.css',
    'package.json',
  ];

  const fileMapBase64 = {};
  const hashAccumulator = createHash('sha256');
  for (const rel of bundleRelFiles) {
    const full = join(rootDir, rel);
    if (existsSync(full)) {
      const buf = preadFile(full);
      fileMapBase64[rel] = buf.toString('base64');
      hashAccumulator.update(rel).update(buf);
    }
  }

  const contentHash = hashAccumulator.digest('hex').slice(0, 8);
  const now = Date.now();
  const dateTag = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const buildId = `${version}-ota-${dateTag}-${contentHash}`;

  const manifest = {
    version,
    buildId,
    buildTimestamp: now,
    releaseNotes:
      'v1.1.2: 내부 명칭·프로토콜·저장소를 100% Toobar로 완전 일원화 및 구버전 자동 정리',
    hash: contentHash,
  };

  const filesGzipBase64 = gzipSync(Buffer.from(JSON.stringify(fileMapBase64), 'utf8')).toString(
    'base64'
  );

  const bundlePayload = {
    manifest,
    filesGzipBase64,
  };

  mkdirSync(join(rootDir, 'dist'), { recursive: true });
  writeFileSync(
    join(rootDir, 'dist/update-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  writeFileSync(join(rootDir, 'dist/update-bundle.json'), JSON.stringify(bundlePayload), 'utf8');

  console.log(
    `Generated OTA Update Bundle: ${buildId} (${Math.round(filesGzipBase64.length / 1024)} KB)`
  );
  return bundlePayload;
}

function publishToRunningInstance(bundlePayload) {
  return new Promise((resolvePub) => {
    try {
      const bodyBuf = Buffer.from(JSON.stringify(bundlePayload), 'utf8');
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: 3001,
          path: '/api/publish-update',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': bodyBuf.length,
          },
          timeout: 2000,
        },
        (res) => {
          res.resume();
          if (res.statusCode === 200) {
            console.log(
              '⚡ Live OTA Update automatically pushed to running Toobar instance & P2P peers!'
            );
          }
          resolvePub();
        }
      );
      req.on('error', () => resolvePub());
      req.on('timeout', () => {
        req.destroy();
        resolvePub();
      });
      req.write(bodyBuf);
      req.end();
    } catch {
      resolvePub();
    }
  });
}

async function main() {
  compileTsFile('src/shared/types.ts', 'dist/shared/types.js');
  compileTsFile('src/main/index.ts', 'dist/main/index.js');
  compileTsFile('src/main/preload.ts', 'dist/main/preload.js');
  compileTsFile('src/signaling/server.ts', 'dist/signaling/server.js');

  const assetsDir = join(rootDir, 'dist/renderer/assets');
  mkdirSync(assetsDir, { recursive: true });

  const esbuild = await import('esbuild');

  const preadPlugin = {
    name: 'pread-loader',
    setup(build) {
      build.onResolve({ filter: /^@shared\// }, (args) => {
        const sub = args.path.replace(/^@shared\//, '');
        const candidateTs = join(rootDir, 'src/shared', `${sub}.ts`);
        return {
          path: existsSync(candidateTs) ? candidateTs : join(rootDir, 'src/shared', sub),
        };
      });
      build.onLoad({ filter: /\.(tsx|ts|jsx|js|mjs|cjs|css|json)$/ }, (args) => {
        const ext = extname(args.path).slice(1);
        const loaderMap = {
          tsx: 'tsx',
          ts: 'ts',
          jsx: 'jsx',
          js: 'js',
          mjs: 'js',
          cjs: 'js',
          css: 'css',
          json: 'json',
        };
        return {
          contents: preadFile(args.path, 'utf8'),
          loader: loaderMap[ext] || 'js',
        };
      });
    },
  };

  await esbuild.build({
    entryPoints: [join(rootDir, 'src/renderer/src/main.tsx')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2019'],
    outfile: join(assetsDir, 'main.js'),
    plugins: [preadPlugin],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  const iconPngSrc = join(rootDir, 'public/icon.png');
  if (existsSync(iconPngSrc)) {
    writeFileSync(join(rootDir, 'dist/renderer/icon.png'), preadFile(iconPngSrc));
  }

  const webManifest = {
    name: 'Toobar - 화상 회의 · 문자 · 파일 공유',
    short_name: 'Toobar',
    description: '맥북·아이폰·아이패드·윈도우·우분투·안드로이드 화상 회의, 문자 메신저 및 파일 공유',
    start_url: './index.html',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0b0f19',
    theme_color: '#0b0f19',
    icons: [
      {
        src: './icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  };
  writeFileSync(
    join(rootDir, 'dist/renderer/manifest.webmanifest'),
    JSON.stringify(webManifest, null, 2),
    'utf8'
  );

  const html = `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0f19" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Toobar" />
    <link rel="apple-touch-icon" href="./icon.png" />
    <link rel="icon" type="image/png" href="./icon.png" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <title>Toobar - 화상 회의 · 문자 · 파일 공유</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="./assets/main.css">
    <script defer src="./assets/main.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

  writeFileSync(join(rootDir, 'dist/renderer/index.html'), html, 'utf8');
  console.log('Bundled renderer -> dist/renderer/index.html');

  const bundlePayload = generateOtaUpdateBundle();
  await updatePackagedAsar();
  await publishToRunningInstance(bundlePayload);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
