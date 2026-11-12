import { execSync } from 'child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');
mkdirSync(publicDir, { recursive: true });

const tmpDir = '/tmp/toobar-icon-build';
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

// 1. Write SVG icon for web/renderer usage
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E3A8A" />
      <stop offset="45%" stop-color="#2563EB" />
      <stop offset="100%" stop-color="#06B6D4" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.98" />
      <stop offset="100%" stop-color="#E0F2FE" stop-opacity="0.92" />
    </linearGradient>
    <linearGradient id="lensGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1D4ED8" />
      <stop offset="100%" stop-color="#0891B2" />
    </linearGradient>
    <linearGradient id="barGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="100%" stop-color="#818CF8" />
    </linearGradient>
  </defs>
  <!-- Squircle Background -->
  <rect x="88" y="88" width="848" height="848" rx="196" ry="196" fill="url(#bgGrad)" />
  <rect x="92" y="92" width="840" height="840" rx="192" ry="192" fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="8" />

  <!-- Top "Toobar" Floating Collaboration Bar ("T" top bar) -->
  <rect x="220" y="236" width="584" height="88" rx="44" ry="44" fill="#0F172A" fill-opacity="0.38" />
  <rect x="232" y="246" width="560" height="68" rx="34" ry="34" fill="url(#barGrad)" />
  <circle cx="290" cy="280" r="14" fill="#FFFFFF" />
  <circle cx="342" cy="280" r="14" fill="#FFFFFF" fill-opacity="0.75" />
  <rect x="386" y="268" width="190" height="24" rx="12" fill="#FFFFFF" fill-opacity="0.9" />
  <circle cx="734" cy="280" r="16" fill="#34D399" />

  <!-- Main Video Camera Body -->
  <rect x="220" y="376" width="416" height="360" rx="76" ry="76" fill="url(#cardGrad)" />

  <!-- Video Camera Projection Cone (Right) -->
  <path d="M 664 472 L 792 394 C 814 380 842 396 842 422 L 842 690 C 842 716 814 732 792 718 L 664 640 Z" fill="url(#cardGrad)" />

  <!-- Camera Lens & T-Monogram Centerpiece -->
  <circle cx="428" cy="556" r="112" fill="url(#lensGrad)" />
  <circle cx="428" cy="556" r="82" fill="#0F172A" />
  <!-- Bold 'T' inside Lens -->
  <path d="M 376 508 H 480 V 534 H 442 V 612 H 414 V 534 H 376 Z" fill="#38BDF8" />
  <!-- Lens Specular Highlight -->
  <circle cx="394" cy="518" r="16" fill="#FFFFFF" fill-opacity="0.65" />
</svg>`;

writeFileSync(join(publicDir, 'icon.svg'), svgContent, 'utf8');

// 2. Write Swift CoreGraphics renderer to create a crisp 1024x1024 master PNG with shadows, glow & anti-aliasing
const swiftScript = `import Cocoa
import CoreGraphics

let size = 1024
let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
let context = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = context
let cg = context.cgContext

cg.setAllowsAntialiasing(true)
cg.setShouldAntialias(true)
cg.interpolationQuality = .high

// Clear canvas
cg.clear(CGRect(x: 0, y: 0, width: size, height: size))

let colorSpace = CGColorSpaceCreateDeviceRGB()

// 1. Outer soft drop shadow for macOS squircle
cg.saveGState()
cg.setShadow(offset: CGSize(width: 0, height: -22), blur: 42, color: NSColor(calibratedWhite: 0.0, alpha: 0.42).cgColor)
let bgRect = CGRect(x: 92, y: 92, width: 840, height: 840)
let bgPath = CGPath(roundedRect: bgRect, cornerWidth: 192, cornerHeight: 192, transform: nil)
cg.addPath(bgPath)
cg.setFillColor(NSColor(calibratedRed: 0.09, green: 0.18, blue: 0.48, alpha: 1.0).cgColor)
cg.fillPath()
cg.restoreGState()

// 2. Clip to Squircle and draw rich multi-stop diagonal gradient
cg.saveGState()
cg.addPath(bgPath)
cg.clip()

let bgColors: [CGColor] = [
    NSColor(calibratedRed: 0.07, green: 0.11, blue: 0.28, alpha: 1.0).cgColor,
    NSColor(calibratedRed: 0.13, green: 0.32, blue: 0.85, alpha: 1.0).cgColor,
    NSColor(calibratedRed: 0.02, green: 0.68, blue: 0.88, alpha: 1.0).cgColor
]
let bgLocations: [CGFloat] = [0.0, 0.52, 1.0]
let bgGrad = CGGradient(colorsSpace: colorSpace, colors: bgColors as CFArray, locations: bgLocations)!
cg.drawLinearGradient(bgGrad, start: CGPoint(x: 92, y: 932), end: CGPoint(x: 932, y: 92), options: [])

// Subtle ambient glow in top-left & bottom-right
let glowColors: [CGColor] = [
    NSColor(calibratedRed: 0.38, green: 0.65, blue: 0.98, alpha: 0.42).cgColor,
    NSColor(calibratedRed: 0.38, green: 0.65, blue: 0.98, alpha: 0.0).cgColor
]
let glowGrad = CGGradient(colorsSpace: colorSpace, colors: glowColors as CFArray, locations: [0.0, 1.0])!
cg.drawRadialGradient(glowGrad, startCenter: CGPoint(x: 260, y: 780), startRadius: 0, endCenter: CGPoint(x: 260, y: 780), endRadius: 480, options: [.drawsBeforeStartLocation])

// Subtle decorative grid/wave ring inside squircle
cg.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.07).cgColor)
cg.setLineWidth(3)
cg.strokeEllipse(in: CGRect(x: 160, y: 160, width: 704, height: 704))

// 3. Top "Toobar" Smart Toolbar Pill (Floating glass bar at top of icon)
cg.saveGState()
cg.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: NSColor(calibratedRed: 0.02, green: 0.06, blue: 0.18, alpha: 0.45).cgColor)
let barRect = CGRect(x: 216, y: 676, width: 592, height: 92)
let barPath = CGPath(roundedRect: barRect, cornerWidth: 46, cornerHeight: 46, transform: nil)
cg.addPath(barPath)
cg.setFillColor(NSColor(calibratedRed: 0.06, green: 0.11, blue: 0.24, alpha: 0.65).cgColor)
cg.fillPath()
cg.restoreGState()

// Toolbar inner border
cg.addPath(barPath)
cg.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.28).cgColor)
cg.setLineWidth(3.5)
cg.strokePath()

// Toolbar status dots & pill (representing Toobar controls)
// Green live dot
cg.setFillColor(NSColor(calibratedRed: 0.20, green: 0.83, blue: 0.60, alpha: 1.0).cgColor)
cg.fillEllipse(in: CGRect(x: 256, y: 704, width: 36, height: 36))
// Cyan dot
cg.setFillColor(NSColor(calibratedRed: 0.22, green: 0.74, blue: 0.97, alpha: 1.0).cgColor)
cg.fillEllipse(in: CGRect(x: 312, y: 704, width: 36, height: 36))
// White toolbar slider bar
let pillBar = CGPath(roundedRect: CGRect(x: 374, y: 710, width: 240, height: 24), cornerWidth: 12, cornerHeight: 12, transform: nil)
cg.addPath(pillBar)
cg.setFillColor(NSColor(calibratedWhite: 1.0, alpha: 0.90).cgColor)
cg.fillPath()
// Coral record/live indicator on right of toolbar
cg.setFillColor(NSColor(calibratedRed: 0.98, green: 0.36, blue: 0.42, alpha: 1.0).cgColor)
cg.fillEllipse(in: CGRect(x: 732, y: 704, width: 36, height: 36))

// 4. Main Video Camera Body + Right Projection Wing
cg.saveGState()
cg.setShadow(offset: CGSize(width: 0, height: -18), blur: 36, color: NSColor(calibratedRed: 0.02, green: 0.06, blue: 0.20, alpha: 0.50).cgColor)

// Camera body rounded rect
let camRect = CGRect(x: 212, y: 246, width: 424, height: 364)
let camPath = CGPath(roundedRect: camRect, cornerWidth: 80, cornerHeight: 80, transform: nil)

// Camera lens projection cone (right side)
let wingPath = CGMutablePath()
wingPath.move(to: CGPoint(x: 660, y: 472))
wingPath.addLine(to: CGPoint(x: 790, y: 558))
wingPath.addQuadCurve(to: CGPoint(x: 834, y: 530), control: CGPoint(x: 834, y: 582))
wingPath.addLine(to: CGPoint(x: 834, y: 326))
wingPath.addQuadCurve(to: CGPoint(x: 790, y: 298), control: CGPoint(x: 834, y: 274))
wingPath.addLine(to: CGPoint(x: 660, y: 384))
wingPath.closeSubpath()

cg.addPath(camPath)
cg.addPath(wingPath)
cg.setFillColor(NSColor.white.cgColor)
cg.fillPath()
cg.restoreGState()

// Gradient fill over camera body + wing for 3D glossy feel
cg.saveGState()
cg.addPath(camPath)
cg.addPath(wingPath)
cg.clip()
let cardColors: [CGColor] = [
    NSColor(calibratedWhite: 1.0, alpha: 1.0).cgColor,
    NSColor(calibratedRed: 0.88, green: 0.95, blue: 1.0, alpha: 1.0).cgColor
]
let cardGrad = CGGradient(colorsSpace: colorSpace, colors: cardColors as CFArray, locations: [0.0, 1.0])!
cg.drawLinearGradient(cardGrad, start: CGPoint(x: 420, y: 610), end: CGPoint(x: 420, y: 246), options: [])
cg.restoreGState()

// 5. Camera Center Lens with "T" (Toobar) Emblem
let lensCenter = CGPoint(x: 424, y: 428)
let outerLensRect = CGRect(x: lensCenter.x - 118, y: lensCenter.y - 118, width: 236, height: 236)

cg.saveGState()
cg.addEllipse(in: outerLensRect)
cg.clip()
let lensRingColors: [CGColor] = [
    NSColor(calibratedRed: 0.15, green: 0.39, blue: 0.92, alpha: 1.0).cgColor,
    NSColor(calibratedRed: 0.02, green: 0.71, blue: 0.83, alpha: 1.0).cgColor
]
let lensRingGrad = CGGradient(colorsSpace: colorSpace, colors: lensRingColors as CFArray, locations: [0.0, 1.0])!
cg.drawLinearGradient(lensRingGrad, start: CGPoint(x: lensCenter.x - 118, y: lensCenter.y + 118), end: CGPoint(x: lensCenter.x + 118, y: lensCenter.y - 118), options: [])
cg.restoreGState()

// Inner dark sapphire lens core
let innerLensRect = CGRect(x: lensCenter.x - 88, y: lensCenter.y - 88, width: 176, height: 176)
cg.setFillColor(NSColor(calibratedRed: 0.06, green: 0.09, blue: 0.20, alpha: 1.0).cgColor)
cg.fillEllipse(in: innerLensRect)

// Crisp glowing "T" inside the lens core
cg.saveGState()
let tTopRect = CGRect(x: lensCenter.x - 52, y: lensCenter.y + 20, width: 104, height: 26)
let tStemRect = CGRect(x: lensCenter.x - 14, y: lensCenter.y - 52, width: 28, height: 84)
let tPath = CGMutablePath()
tPath.addRoundedRect(in: tTopRect, cornerWidth: 10, cornerHeight: 10)
tPath.addRoundedRect(in: tStemRect, cornerWidth: 10, cornerHeight: 10)
cg.addPath(tPath)
cg.setFillColor(NSColor(calibratedRed: 0.22, green: 0.82, blue: 0.98, alpha: 1.0).cgColor)
cg.fillPath()
cg.restoreGState()

// Lens glass reflection highlight
cg.setFillColor(NSColor(calibratedWhite: 1.0, alpha: 0.55).cgColor)
cg.fillEllipse(in: CGRect(x: lensCenter.x - 62, y: lensCenter.y + 42, width: 26, height: 26))
cg.setFillColor(NSColor(calibratedWhite: 1.0, alpha: 0.30).cgColor)
cg.fillEllipse(in: CGRect(x: lensCenter.x - 32, y: lensCenter.y + 56, width: 12, height: 12))

// 6. Outer glass rim border on squircle
cg.addPath(bgPath)
cg.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.32).cgColor)
cg.setLineWidth(10)
cg.strokePath()

cg.restoreGState()
NSGraphicsContext.restoreGraphicsState()

let pngData = rep.representation(using: .png, properties: [:])!
try! pngData.write(to: URL(fileURLWithPath: "${join(tmpDir, 'icon-1024.png')}"))
`;

const swiftFile = join(tmpDir, 'render_icon.swift');
writeFileSync(swiftFile, swiftScript, 'utf8');
console.log('Rendering 1024x1024 master Toobar icon via macOS CoreGraphics...');
execSync(`swift "${swiftFile}"`, { stdio: 'inherit' });

const masterPng = join(tmpDir, 'icon-1024.png');

// Copy 512x512 PNG to public/icon.png
execSync(`sips -z 512 512 "${masterPng}" --out "${join(publicDir, 'icon.png')}"`, { stdio: 'ignore' });

// Also create tray-icon.png (44x44 and 22x22)
execSync(`sips -z 44 44 "${masterPng}" --out "${join(publicDir, 'tray-icon.png')}"`, { stdio: 'ignore' });

// 3. Build genuine macOS .iconset and convert to public/icon.icns via iconutil
const iconsetDir = join(tmpDir, 'Toobar.iconset');
mkdirSync(iconsetDir, { recursive: true });

const iconsetSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

for (const [filename, dim] of iconsetSizes) {
  execSync(`sips -z ${dim} ${dim} "${masterPng}" --out "${join(iconsetDir, filename)}"`, {
    stdio: 'ignore',
  });
}

const icnsOut = join(publicDir, 'icon.icns');
execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsOut}"`, { stdio: 'inherit' });
execSync(`xattr -c "${icnsOut}"`, { stdio: 'ignore' });
console.log(`Generated genuine macOS .icns: ${icnsOut} (${readFileSync(icnsOut).length} bytes)`);

// 4. Build genuine multi-resolution Windows .ico file (16, 32, 48, 64, 128, 256 PNG frames)
const icoSizes = [16, 32, 48, 64, 128, 256];
const pngBuffers = [];
for (const dim of icoSizes) {
  const p = join(tmpDir, `ico_${dim}.png`);
  execSync(`sips -z ${dim} ${dim} "${masterPng}" --out "${p}"`, { stdio: 'ignore' });
  pngBuffers.push({ dim, buf: readFileSync(p) });
}

const headerSize = 6;
const dirEntrySize = 16;
let dataOffset = headerSize + dirEntrySize * pngBuffers.length;

const icoHeader = Buffer.alloc(headerSize);
icoHeader.writeUInt16LE(0, 0); // Reserved
icoHeader.writeUInt16LE(1, 2); // Type 1 = ICO
icoHeader.writeUInt16LE(pngBuffers.length, 4); // Image count

const dirEntries = [];
const imageBlocks = [];

for (const { dim, buf } of pngBuffers) {
  const entry = Buffer.alloc(dirEntrySize);
  entry.writeUInt8(dim === 256 ? 0 : dim, 0); // Width (0 means 256)
  entry.writeUInt8(dim === 256 ? 0 : dim, 1); // Height (0 means 256)
  entry.writeUInt8(0, 2); // Color palette
  entry.writeUInt8(0, 3); // Reserved
  entry.writeUInt16LE(1, 4); // Color planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(buf.length, 8); // Image byte size
  entry.writeUInt32LE(dataOffset, 12); // Offset in file
  dirEntries.push(entry);
  imageBlocks.push(buf);
  dataOffset += buf.length;
}

const icoBuffer = Buffer.concat([icoHeader, ...dirEntries, ...imageBlocks]);
const icoOut = join(publicDir, 'icon.ico');
writeFileSync(icoOut, icoBuffer);
console.log(`Generated genuine Windows .ico: ${icoOut} (${icoBuffer.length} bytes)`);

// 5. Copy icon.icns into packaged macOS apps if present
const macAppIcnsTargets = [
  join(rootDir, 'dist-electron/mac-arm64/Toobar.app/Contents/Resources/icon.icns'),
  '/Applications/Toobar.app/Contents/Resources/icon.icns',
];

for (const target of macAppIcnsTargets) {
  if (existsSync(dirname(target))) {
    copyFileSync(icnsOut, target);
    console.log(`Updated macOS bundle icon: ${target}`);
  }
}
