import { execSync } from 'child_process';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
  symlinkSync,
  existsSync,
  chmodSync,
  renameSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, '..');
const pkgJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
const version = pkgJson.version || '1.1.0';
const distElectron = join(projectDir, 'dist-electron');
mkdirSync(distElectron, { recursive: true });

// Locate Linux unpacked source
const candidates = [
  join(distElectron, 'linux-unpacked'),
  '/tmp/toobar-linux-build/linux-unpacked',
  '/tmp/toobar-linux-build/data/opt/ZoomClone',
  '/tmp/toobar-linux-build/data/opt/Toobar',
];
const sourceUnpacked = candidates.find((p) => existsSync(join(p, 'resources/app.asar')));
if (!sourceUnpacked) {
  throw new Error('Could not find Linux unpacked directory with resources/app.asar');
}

const cleanLinuxUnpacked = '/tmp/toobar-linux-build/linux-unpacked';
if (sourceUnpacked !== cleanLinuxUnpacked) {
  rmSync(cleanLinuxUnpacked, { recursive: true, force: true });
  mkdirSync(cleanLinuxUnpacked, { recursive: true });
  cpSync(sourceUnpacked, cleanLinuxUnpacked, { recursive: true });
}

// Ensure cleanLinuxUnpacked comes directly from fresh electron-builder Linux output
const distAsar = join(distElectron, 'linux-unpacked/resources/app.asar');
if (existsSync(distAsar) && cleanLinuxUnpacked !== join(distElectron, 'linux-unpacked')) {
  cpSync(distAsar, join(cleanLinuxUnpacked, 'resources/app.asar'));
}

// Rename ELF binary to toobar-bin and create --no-sandbox wrapper as 'toobar' (and 'zoom-clone' symlink)
const oldBinZoom = join(cleanLinuxUnpacked, 'zoom-clone');
const toobarBin = join(cleanLinuxUnpacked, 'toobar-bin');
const toobarWrapper = join(cleanLinuxUnpacked, 'toobar');

if (existsSync(oldBinZoom) && !existsSync(toobarBin)) {
  renameSync(oldBinZoom, toobarBin);
} else if (existsSync(toobarWrapper) && !existsSync(toobarBin)) {
  renameSync(toobarWrapper, toobarBin);
}

if (existsSync(toobarBin)) {
  chmodSync(toobarBin, 0o755);
}

const wrapperScript = `#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
export ELECTRON_DISABLE_SANDBOX=1
exec "$DIR/toobar-bin" --no-sandbox --disable-gpu-sandbox "$@"
`;
writeFileSync(toobarWrapper, wrapperScript, { mode: 0o755 });
chmodSync(toobarWrapper, 0o755);

if (existsSync(join(cleanLinuxUnpacked, 'chrome-sandbox'))) {
  chmodSync(join(cleanLinuxUnpacked, 'chrome-sandbox'), 0o755);
}
if (existsSync(join(cleanLinuxUnpacked, 'chrome_crashpad_handler'))) {
  chmodSync(join(cleanLinuxUnpacked, 'chrome_crashpad_handler'), 0o755);
}

// Build Debian package (.deb) for Ubuntu 20.04 / 22.04 / 24.04 LTS
const stageDir = '/tmp/toobar-deb-stage';
rmSync(stageDir, { recursive: true, force: true });

const dataDir = join(stageDir, 'data');
const controlDir = join(stageDir, 'control');
mkdirSync(join(dataDir, 'opt/Toobar'), { recursive: true });
mkdirSync(join(dataDir, 'usr/bin'), { recursive: true });
mkdirSync(join(dataDir, 'usr/share/applications'), { recursive: true });
mkdirSync(join(dataDir, 'usr/share/icons/hicolor/512x512/apps'), { recursive: true });
mkdirSync(join(dataDir, 'usr/share/pixmaps'), { recursive: true });
mkdirSync(controlDir, { recursive: true });

console.log(`Copying Linux app files from ${cleanLinuxUnpacked}...`);
cpSync(cleanLinuxUnpacked, join(dataDir, 'opt/Toobar'), { recursive: true });
chmodSync(join(dataDir, 'opt/Toobar/toobar'), 0o755);
if (existsSync(join(dataDir, 'opt/Toobar/toobar-bin'))) {
  chmodSync(join(dataDir, 'opt/Toobar/toobar-bin'), 0o755);
}

cpSync(
  join(projectDir, 'public/icon.png'),
  join(dataDir, 'usr/share/icons/hicolor/512x512/apps/toobar.png')
);
cpSync(join(projectDir, 'public/icon.png'), join(dataDir, 'usr/share/pixmaps/toobar.png'));

symlinkSync('/opt/Toobar/toobar', join(dataDir, 'usr/bin/toobar'));
symlinkSync('/opt/Toobar/toobar', join(dataDir, 'usr/bin/zoom-clone'));

writeFileSync(
  join(dataDir, 'usr/share/applications/toobar.desktop'),
  `[Desktop Entry]
Name=Toobar
GenericName=Video Conferencing
Comment=Toobar - 화상 회의 프로그램 (Electron + WebRTC)
Exec=/opt/Toobar/toobar %U
TryExec=/opt/Toobar/toobar
Terminal=false
Type=Application
Icon=toobar
StartupWMClass=Toobar
Categories=Network;AudioVideo;VideoConference;
MimeType=x-scheme-handler/toobar;x-scheme-handler/zoomclone;
`
);

writeFileSync(
  join(controlDir, 'control'),
  `Package: toobar
Version: ${version}
Section: video
Priority: optional
Architecture: amd64
Replaces: zoom-clone
Conflicts: zoom-clone
Maintainer: Toobar Team <support@toobar.app>
Depends: libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libgbm1, libasound2 | libasound2t64
Description: Toobar - Cross-platform video conferencing, messenger & file sharing app
`
);

const postinstPath = join(controlDir, 'postinst');
writeFileSync(
  postinstPath,
  `#!/bin/sh
set -e
chmod 755 /opt/Toobar/toobar /opt/Toobar/toobar-bin 2>/dev/null || true
chmod 4755 /opt/Toobar/chrome-sandbox 2>/dev/null || true
update-desktop-database /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
xdg-mime default toobar.desktop x-scheme-handler/toobar 2>/dev/null || true
xdg-mime default toobar.desktop x-scheme-handler/zoomclone 2>/dev/null || true
exit 0
`,
  { mode: 0o755 }
);
chmodSync(postinstPath, 0o755);

const debianBinary = Buffer.from('2.0\n', 'utf8');

console.log('Creating control.tar.gz and data.tar.gz...');
execSync('COPYFILE_DISABLE=1 tar -czf control.tar.gz -C control .', { cwd: stageDir });
execSync('COPYFILE_DISABLE=1 tar -czf data.tar.gz -C data .', { cwd: stageDir });

const controlTarGz = readFileSync(join(stageDir, 'control.tar.gz'));
const dataTarGz = readFileSync(join(stageDir, 'data.tar.gz'));

function makeArMember(name, content) {
  const mtime = Math.floor(Date.now() / 1000).toString();
  const headerStr =
    name.padEnd(16, ' ') +
    mtime.padEnd(12, ' ') +
    '0'.padEnd(6, ' ') +
    '0'.padEnd(6, ' ') +
    '100644'.padEnd(8, ' ') +
    content.length.toString().padEnd(10, ' ') +
    '`\n';
  const header = Buffer.from(headerStr, 'ascii');
  if (content.length % 2 === 1) {
    return Buffer.concat([header, content, Buffer.from('\n', 'ascii')]);
  }
  return Buffer.concat([header, content]);
}

console.log(`Writing Debian archive Toobar_${version}_amd64.deb...`);
const debBuffer = Buffer.concat([
  Buffer.from('!<arch>\n', 'ascii'),
  makeArMember('debian-binary', debianBinary),
  makeArMember('control.tar.gz', controlTarGz),
  makeArMember('data.tar.gz', dataTarGz),
]);

const targetDeb = join(distElectron, `Toobar_${version}_amd64.deb`);
writeFileSync(targetDeb, debBuffer);

// Also build portable Ubuntu/Linux tar.gz archive
const targetTarGz = join(distElectron, `Toobar-${version}-ubuntu-amd64.tar.gz`);
execSync(`COPYFILE_DISABLE=1 tar -czf "${targetTarGz}" -C "/tmp/toobar-linux-build" linux-unpacked`);

rmSync(stageDir, { recursive: true, force: true });
console.log(`✅ Built ${targetDeb}`);
console.log(`✅ Built ${targetTarGz}`);
