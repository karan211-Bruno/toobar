import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const rootDir = process.cwd();
const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkgJson.version || '1.1.0';
const distElectronDir = path.join(rootDir, 'dist-electron');
const sourceApp = path.join(distElectronDir, 'mac-arm64', 'Toobar.app');
const publicIconIcns = path.join(rootDir, 'public', 'icon.icns');

function bumpPlistVersion(plistPath, ver) {
  if (!fs.existsSync(plistPath)) return;
  let xml = fs.readFileSync(plistPath, 'utf8');
  xml = xml.replace(
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${ver}$2`
  );
  xml = xml.replace(
    /(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${ver}$2`
  );
  fs.writeFileSync(plistPath, xml, 'utf8');
}

console.log('1. Syncing and signing /Applications/Toobar.app...');
if (fs.existsSync(sourceApp)) {
  bumpPlistVersion(path.join(sourceApp, 'Contents', 'Info.plist'), version);
  if (fs.existsSync(publicIconIcns)) {
    fs.copyFileSync(publicIconIcns, path.join(sourceApp, 'Contents', 'Resources', 'icon.icns'));
  }
  execSync(`rm -rf "/Applications/Toobar.app" && ditto "${sourceApp}" "/Applications/Toobar.app"`, { stdio: 'inherit' });
}
bumpPlistVersion('/Applications/Toobar.app/Contents/Info.plist', version);
if (fs.existsSync(publicIconIcns)) {
  fs.copyFileSync(publicIconIcns, '/Applications/Toobar.app/Contents/Resources/icon.icns');
}
execSync(`xattr -cr "/Applications/Toobar.app"`, { stdio: 'inherit' });
execSync(`codesign --force --deep --sign - "/Applications/Toobar.app"`, { stdio: 'inherit' });
execSync(`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Toobar.app"`, { stdio: 'inherit' });

console.log('2. Preparing DMG staging folder (/tmp/toobar-dmg-stage)...');
const dmgStage = '/tmp/toobar-dmg-stage';
execSync(`rm -rf "${dmgStage}" && mkdir -p "${dmgStage}"`, { stdio: 'inherit' });
execSync(`ditto "/Applications/Toobar.app" "${dmgStage}/Toobar.app"`, { stdio: 'inherit' });
execSync(`xattr -cr "${dmgStage}/Toobar.app"`, { stdio: 'inherit' });

// Add /Applications symlink for Drag & Drop installation
execSync(`ln -s /Applications "${dmgStage}/Applications"`, { stdio: 'inherit' });

// Add custom volume icon
if (fs.existsSync(publicIconIcns)) {
  fs.copyFileSync(publicIconIcns, path.join(dmgStage, '.VolumeIcon.icns'));
  try {
    execSync(`SetFile -a C "${dmgStage}"`, { stdio: 'ignore' });
  } catch {
    // SetFile is optional if Xcode command line tools omit it
  }
}

// Create One-Click Auto Installer script inside DMG
const oneClickScriptPath = path.join(dmgStage, '⚡ Toobar 원클릭 자동설치.command');
const oneClickScript = `#!/bin/bash
clear
echo "===================================================="
echo "  🚀 Toobar (투바) macOS 원클릭 자동 설치기 v${version}"
echo "===================================================="
echo ""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$SCRIPT_DIR/Toobar.app"
APP_DST="/Applications/Toobar.app"

if [ ! -d "$APP_SRC" ]; then
  echo "❌ Toobar.app 파일을 찾을 수 없습니다."
  read -p "엔터 키를 누르면 창이 닫힙니다..."
  exit 1
fi

echo "1/4. 기존 실행 중인 Toobar 종료 중..."
killall Toobar >/dev/null 2>&1 || true

echo "2/4. /Applications 폴더로 Toobar.app 복사 중..."
rm -rf "$APP_DST"
ditto "$APP_SRC" "$APP_DST"

echo "3/4. macOS 보안 격리(Gatekeeper) 해제 및 서명 적용 중..."
xattr -cr "$APP_DST" 2>/dev/null || true
codesign --force --deep --sign - "$APP_DST" 2>/dev/null || true

echo "4/4. toobar:// 초대 링크 핸들러 등록 중..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DST" 2>/dev/null || true

echo ""
echo "✅ Toobar 설치가 완료되었습니다! 앱을 실행합니다..."
open "$APP_DST"
sleep 1
exit 0
`;
fs.writeFileSync(oneClickScriptPath, oneClickScript, { mode: 0o755 });
execSync(`chmod +x "${oneClickScriptPath}"`, { stdio: 'inherit' });

// Create README guide inside DMG
const readmePath = path.join(dmgStage, '설치 안내 (필독).txt');
const readmeContent = `[Toobar macOS 설치 방법 안내]

방법 1 (원클릭 자동 설치 - 권장):
  - '⚡ Toobar 원클릭 자동설치.command' 파일을 더블클릭하면
    응용 프로그램(/Applications) 복사, 보안 경고가 뜨지 않도록 격리 해제,
    초대 링크(toobar://) 등록 및 실행까지 자동으로 완료됩니다!

방법 2 (드래그 앤 드롭 설치):
  - 'Toobar.app' 아이콘을 'Applications' 폴더로 드래그하여 넣으세요.
  - 만약 처음 실행 시 "확인되지 않은 개발자" 또는 보안 경고가 표시되면,
    우클릭 -> '열기'를 누르거나 '⚡ Toobar 원클릭 자동설치.command'를 실행해 주세요.
`;
fs.writeFileSync(readmePath, readmeContent, 'utf8');

console.log(`3. Building Toobar-${version}-arm64.dmg...`);
const dmgOut = path.join(distElectronDir, `Toobar-${version}-arm64.dmg`);
if (fs.existsSync(dmgOut)) fs.unlinkSync(dmgOut);
execSync(
  `hdiutil create -volname "Toobar Installer" -srcfolder "${dmgStage}" -ov -format UDZO "${dmgOut}"`,
  { stdio: 'inherit' }
);

console.log(`4. Building native macOS PKG installer (Toobar-${version}-arm64.pkg)...`);
const pkgScriptsDir = '/tmp/toobar-pkg-scripts';
execSync(`rm -rf "${pkgScriptsDir}" && mkdir -p "${pkgScriptsDir}"`, { stdio: 'inherit' });
const postinstallPath = path.join(pkgScriptsDir, 'postinstall');
const postinstallScript = `#!/bin/bash
if [ -d "/Applications/Toobar.app" ]; then
  xattr -cr "/Applications/Toobar.app" 2>/dev/null || true
  codesign --force --deep --sign - "/Applications/Toobar.app" 2>/dev/null || true
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Toobar.app" 2>/dev/null || true
fi
exit 0
`;
fs.writeFileSync(postinstallPath, postinstallScript, { mode: 0o755 });
execSync(`chmod +x "${postinstallPath}"`, { stdio: 'inherit' });

const pkgOut = path.join(distElectronDir, `Toobar-${version}-arm64.pkg`);
if (fs.existsSync(pkgOut)) fs.unlinkSync(pkgOut);
execSync(
  `pkgbuild --component "${dmgStage}/Toobar.app" --install-location /Applications --scripts "${pkgScriptsDir}" --identifier com.toobar.app.pkg --version ${version} "${pkgOut}"`,
  { stdio: 'inherit' }
);

console.log(`5. Building Toobar-${version}-arm64-mac.zip...`);
const zipOut = path.join(distElectronDir, `Toobar-${version}-arm64-mac.zip`);
if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);
execSync(`ditto -c -k --sequesterRsrc --keepParent "${dmgStage}/Toobar.app" "${zipOut}"`, { stdio: 'inherit' });

console.log('✅ macOS Installers built successfully:');
console.log('  - DMG:', dmgOut);
console.log('  - PKG:', pkgOut);
console.log('  - ZIP:', zipOut);
