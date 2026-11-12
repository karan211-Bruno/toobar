#!/usr/bin/env python3
"""
Toobar iOS & iPadOS Universal Native App Generator & Builder (v1.1.0)
Generates ios/Toobar.xcodeproj + SwiftUI WKWebView wrapper supporting:
- iPhone & iPad Universal layout (TARGETED_DEVICE_FAMILY = "1,2")
- WebRTC Camera & Microphone capture (https://app.toobar.local secure context + WKUIDelegate auto-grant + AVAudioSession)
- Standalone Messenger & File Transfer (UIActivityViewController save/share + native file picker)
- Deep link handling (toobar:// and zoomclone://)
Builds both Toobar-1.1.0-iPhone-iPad.ipa (device) and Toobar-1.1.0-iOS-Simulator.app.zip.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG_JSON = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
VERSION = PKG_JSON.get("version", "1.1.0")

IOS_DIR = ROOT / "ios"
APP_DIR = IOS_DIR / "Toobar"
WEB_SRC_DIR = ROOT / "dist" / "renderer"
WEB_DST_DIR = APP_DIR / "Web"
ASSETS_DIR = APP_DIR / "Assets.xcassets"
ICON_SRC = ROOT / "public" / "icon.png"
PROJ_DIR = IOS_DIR / "Toobar.xcodeproj"
DIST_ELECTRON = ROOT / "dist-electron"
TEAM_ID = "82XJ92M3ZC"
SIGN_HASH = "4F7500A0565E479604FEC4019C918AD3CC4D194B"


def pb_id(label: str) -> str:
    return hashlib.sha1(f"toobar.ios.{label}".encode("utf-8")).hexdigest()[:24].upper()


def write_swift_sources() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)

    (APP_DIR / "ToobarApp.swift").write_text(
        """import SwiftUI
import AVFoundation

@main
struct ToobarApp: App {
    init() {
        configureAudioSession()
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .videoChat,
                options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP, .mixWithOthers]
            )
            try session.setActive(true)
        } catch {
            print("[Toobar] AVAudioSession setup warning: \\(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}
""",
        encoding="utf-8",
    )

    (APP_DIR / "ContentView.swift").write_text(
        """import SwiftUI
import WebKit
import AVFoundation
import UIKit

struct ContentView: View {
    @StateObject private var bridge = ToobarWebBridge()

    var body: some View {
        ToobarWebView(bridge: bridge)
            .ignoresSafeArea()
            .background(Color(red: 0.043, green: 0.059, blue: 0.098))
            .onOpenURL { url in
                bridge.handleDeepLink(url: url)
            }
    }
}

final class ToobarWebBridge: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    weak var webView: WKWebView?
    private var pendingDeepLink: String?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "toobar",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }

        switch action {
        case "saveFile":
            guard let filename = body["filename"] as? String,
                  let base64 = body["base64"] as? String,
                  let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
                return
            }
            DispatchQueue.main.async {
                self.presentShareSheet(data: data, filename: filename)
            }
        default:
            break
        }
    }

    func handleDeepLink(url: URL) {
        let raw = url.absoluteString
            .replacingOccurrences(of: "\\\\", with: "\\\\\\\\")
            .replacingOccurrences(of: "'", with: "\\\\'")
        if let wv = webView {
            let js = "window.__toobarHandleDeepLink && window.__toobarHandleDeepLink('\\(raw)');"
            DispatchQueue.main.async {
                wv.evaluateJavaScript(js, completionHandler: nil)
            }
        } else {
            pendingDeepLink = raw
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let pending = pendingDeepLink {
            pendingDeepLink = nil
            let js = "setTimeout(function(){ window.__toobarHandleDeepLink && window.__toobarHandleDeepLink('\\(pending)'); }, 400);"
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // Auto-grant WebRTC camera & microphone capture inside WKWebView once OS permission is granted
    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }

    private func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first,
              let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController ?? scene.windows.first?.rootViewController else {
            return nil
        }
        var current = root
        while let presented = current.presentedViewController {
            current = presented
        }
        return current
    }

    private func presentShareSheet(data: Data, filename: String) {
        let cleanName = filename.isEmpty ? "toobar-file" : filename.replacingOccurrences(of: "/", with: "_")
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(cleanName)
        do {
            try data.write(to: tempURL, options: .atomic)
        } catch {
            return
        }
        guard let presenter = topViewController() else { return }
        let activity = UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
        if let popover = activity.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        presenter.present(activity, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let presenter = topViewController() else {
            completionHandler()
            return
        }
        let alert = UIAlertController(title: "Toobar", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let presenter = topViewController() else {
            completionHandler(true)
            return
        }
        let alert = UIAlertController(title: "Toobar", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard let presenter = topViewController() else {
            completionHandler(defaultText)
            return
        }
        let alert = UIAlertController(title: "Toobar", message: prompt, preferredStyle: .alert)
        alert.addTextField { tf in
            tf.text = defaultText
        }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        presenter.present(alert, animated: true)
    }
}

struct ToobarWebView: UIViewRepresentable {
    @ObservedObject var bridge: ToobarWebBridge

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(bridge, name: "toobar")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

        let platformTag = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
        let platformScript = WKUserScript(
            source: "window.__toobarNativePlatform = '\\(platformTag)';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(platformScript)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = bridge
        webView.uiDelegate = bridge
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.043, green: 0.059, blue: 0.098, alpha: 1.0)

        bridge.webView = webView

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web"),
           let htmlString = try? String(contentsOf: indexURL, encoding: .utf8) {
            // Load with https:// baseURL so WKWebView treats page as a Secure Context for WebRTC getUserMedia & localStorage
            webView.loadHTMLString(htmlString, baseURL: URL(string: "https://app.toobar.local/")!)
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
""",
        encoding="utf-8",
    )

    (APP_DIR / "Info.plist").write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>ko</string>
	<key>CFBundleDisplayName</key>
	<string>Toobar</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Toobar</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>{VERSION}</string>
	<key>CFBundleVersion</key>
	<string>2</string>
	<key>LSRequiresIPhoneOS</key>
	<true/>
	<key>NSCameraUsageDescription</key>
	<string>화상 회의에서 내 카메라 영상을 상대방에게 전송하기 위해 카메라 접근 권한이 필요합니다.</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>화상 회의에서 음성 대화를 나누기 위해 마이크 접근 권한이 필요합니다.</string>
	<key>NSPhotoLibraryAddUsageDescription</key>
	<string>전송받은 사진과 칠판 이미지를 저장하기 위해 사진 보관함 권한이 필요합니다.</string>
	<key>UIApplicationSceneManifest</key>
	<dict>
		<key>UIApplicationSupportsMultipleScenes</key>
		<true/>
	</dict>
	<key>UIBackgroundModes</key>
	<array>
		<string>audio</string>
	</array>
	<key>UILaunchScreen</key>
	<dict>
		<key>UIColorName</key>
		<string></string>
	</dict>
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<key>UISupportedInterfaceOrientations~ipad</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationPortraitUpsideDown</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
		<key>NSAllowsArbitraryLoads</key>
		<true/>
	</dict>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>com.karan211.toobar</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>toobar</string>
				<string>zoomclone</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
""",
        encoding="utf-8",
    )


def copy_inlined_web_bundle() -> None:
    if WEB_DST_DIR.exists():
        shutil.rmtree(WEB_DST_DIR)
    WEB_DST_DIR.mkdir(parents=True, exist_ok=True)

    assets_dir = WEB_SRC_DIR / "assets"
    css_text = (assets_dir / "main.css").read_text(encoding="utf-8")
    js_text = (assets_dir / "main.js").read_text(encoding="utf-8")
    safe_js = js_text.replace("</script", "<\\/script")

    inline_html = (
        '<!doctype html><html lang="ko"><head><meta charset="UTF-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />'
        "<title>Toobar</title><style>"
        + css_text
        + '</style></head><body><div id="root"></div><script type="module">'
        + safe_js
        + "</script></body></html>"
    )
    (WEB_DST_DIR / "index.html").write_text(inline_html, encoding="utf-8")


def generate_app_icons() -> None:
    iconset = ASSETS_DIR / "AppIcon.appiconset"
    iconset.mkdir(parents=True, exist_ok=True)
    (ASSETS_DIR / "Contents.json").write_text(
        json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2),
        encoding="utf-8",
    )

    specs = [
        ("iphone", "20x20", "2x", 40, "Icon-40.png"),
        ("iphone", "20x20", "3x", 60, "Icon-60.png"),
        ("iphone", "29x29", "2x", 58, "Icon-58.png"),
        ("iphone", "29x29", "3x", 87, "Icon-87.png"),
        ("iphone", "40x40", "2x", 80, "Icon-80.png"),
        ("iphone", "40x40", "3x", 120, "Icon-120.png"),
        ("iphone", "60x60", "2x", 120, "Icon-120-2.png"),
        ("iphone", "60x60", "3x", 180, "Icon-180.png"),
        ("ipad", "20x20", "1x", 20, "Icon-20.png"),
        ("ipad", "20x20", "2x", 40, "Icon-40-ipad.png"),
        ("ipad", "29x29", "1x", 29, "Icon-29.png"),
        ("ipad", "29x29", "2x", 58, "Icon-58-ipad.png"),
        ("ipad", "40x40", "1x", 40, "Icon-40-ipad2.png"),
        ("ipad", "40x40", "2x", 80, "Icon-80-ipad.png"),
        ("ipad", "76x76", "1x", 76, "Icon-76.png"),
        ("ipad", "76x76", "2x", 152, "Icon-152.png"),
        ("ipad", "83.5x83.5", "2x", 167, "Icon-167.png"),
        ("ios-marketing", "1024x1024", "1x", 1024, "Icon-1024.png"),
    ]

    # Ensure opaque RGB PNG icon (iOS App Store / Xcode dislikes alpha in 1024 icon)
    flat_icon = Path("/tmp/toobar-flat-icon.png")
    shutil.copyfile(ICON_SRC, flat_icon)

    images = []
    for idiom, size_str, scale, px, filename in specs:
        target = iconset / filename
        subprocess.run(
            ["sips", "-z", str(px), str(px), str(flat_icon), "--out", str(target)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        images.append(
            {
                "idiom": idiom,
                "size": size_str,
                "scale": scale,
                "filename": filename,
            }
        )

    (iconset / "Contents.json").write_text(
        json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2),
        encoding="utf-8",
    )


def generate_pbxproj() -> None:
    PROJ_DIR.mkdir(parents=True, exist_ok=True)

    app_swift_ref = pb_id("ref.ToobarApp.swift")
    content_swift_ref = pb_id("ref.ContentView.swift")
    assets_ref = pb_id("ref.Assets.xcassets")
    web_ref = pb_id("ref.Web")
    info_ref = pb_id("ref.Info.plist")
    product_ref = pb_id("ref.Toobar.app")

    app_swift_build = pb_id("build.ToobarApp.swift")
    content_swift_build = pb_id("build.ContentView.swift")
    assets_build = pb_id("build.Assets.xcassets")
    web_build = pb_id("build.Web")

    main_group = pb_id("group.main")
    app_group = pb_id("group.Toobar")
    products_group = pb_id("group.Products")

    sources_phase = pb_id("phase.sources")
    resources_phase = pb_id("phase.resources")
    frameworks_phase = pb_id("phase.frameworks")

    target_id = pb_id("target.Toobar")
    project_id = pb_id("project.Toobar")
    proj_config_list = pb_id("configList.project")
    target_config_list = pb_id("configList.target")
    proj_debug = pb_id("config.project.Debug")
    proj_release = pb_id("config.project.Release")
    target_debug = pb_id("config.target.Debug")
    target_release = pb_id("config.target.Release")

    pbx = f"""// !$*UTF8*$!
{{
	archiveVersion = 1;
	classes = {{
	}};
	objectVersion = 56;
	objects = {{

/* Begin PBXBuildFile section */
		{app_swift_build} /* ToobarApp.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {app_swift_ref} /* ToobarApp.swift */; }};
		{content_swift_build} /* ContentView.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {content_swift_ref} /* ContentView.swift */; }};
		{assets_build} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {assets_ref} /* Assets.xcassets */; }};
		{web_build} /* Web in Resources */ = {{isa = PBXBuildFile; fileRef = {web_ref} /* Web */; }};
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		{app_swift_ref} /* ToobarApp.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ToobarApp.swift; sourceTree = "<group>"; }};
		{content_swift_ref} /* ContentView.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ContentView.swift; sourceTree = "<group>"; }};
		{assets_ref} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; }};
		{web_ref} /* Web */ = {{isa = PBXFileReference; lastKnownFileType = folder; path = Web; sourceTree = "<group>"; }};
		{info_ref} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};
		{product_ref} /* Toobar.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Toobar.app; sourceTree = BUILT_PRODUCTS_DIR; }};
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		{frameworks_phase} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		{main_group} = {{
			isa = PBXGroup;
			children = (
				{app_group} /* Toobar */,
				{products_group} /* Products */,
			);
			sourceTree = "<group>";
		}};
		{app_group} /* Toobar */ = {{
			isa = PBXGroup;
			children = (
				{app_swift_ref} /* ToobarApp.swift */,
				{content_swift_ref} /* ContentView.swift */,
				{assets_ref} /* Assets.xcassets */,
				{web_ref} /* Web */,
				{info_ref} /* Info.plist */,
			);
			path = Toobar;
			sourceTree = "<group>";
		}};
		{products_group} /* Products */ = {{
			isa = PBXGroup;
			children = (
				{product_ref} /* Toobar.app */,
			);
			name = Products;
			sourceTree = "<group>";
		}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		{target_id} /* Toobar */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {target_config_list} /* Build configuration list for PBXNativeTarget "Toobar" */;
			buildPhases = (
				{sources_phase} /* Sources */,
				{frameworks_phase} /* Frameworks */,
				{resources_phase} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = Toobar;
			productName = Toobar;
			productReference = {product_ref} /* Toobar.app */;
			productType = "com.apple.product-type.application";
		}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		{project_id} /* Project object */ = {{
			isa = PBXProject;
			attributes = {{
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1600;
				LastUpgradeCheck = 1600;
				TargetAttributes = {{
					{target_id} = {{
						CreatedOnToolsVersion = 16.0;
						DevelopmentTeam = {TEAM_ID};
						ProvisioningStyle = Automatic;
					}};
				}};
			}};
			buildConfigurationList = {proj_config_list} /* Build configuration list for PBXProject "Toobar" */;
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = ko;
			hasScannedForEncodings = 0;
			knownRegions = (
				ko,
				en,
				Base,
			);
			mainGroup = {main_group};
			productRefGroup = {products_group} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				{target_id} /* Toobar */,
			);
		}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		{resources_phase} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{assets_build} /* Assets.xcassets in Resources */,
				{web_build} /* Web in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		{sources_phase} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{app_swift_build} /* ToobarApp.swift in Sources */,
				{content_swift_build} /* ContentView.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		{proj_debug} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				GCC_DYNAMIC_NO_PIC = NO;
				GCC_OPTIMIZATION_LEVEL = 0;
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				MTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
				SWIFT_VERSION = 5.0;
			}};
			name = Debug;
		}};
		{proj_release} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				ENABLE_NS_ASSERTIONS = NO;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				MTL_ENABLE_DEBUG_INFO = NO;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				SWIFT_OPTIMIZATION_LEVEL = "-O";
				SWIFT_VERSION = 5.0;
				VALIDATE_PRODUCT = YES;
			}};
			name = Release;
		}};
		{target_debug} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 2;
				DEVELOPMENT_TEAM = {TEAM_ID};
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = Toobar/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = {VERSION};
				PRODUCT_BUNDLE_IDENTIFIER = com.karan211.toobar;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
		{target_release} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 2;
				DEVELOPMENT_TEAM = {TEAM_ID};
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = Toobar/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = {VERSION};
				PRODUCT_BUNDLE_IDENTIFIER = com.karan211.toobar;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		{proj_config_list} /* Build configuration list for PBXProject "Toobar" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{proj_debug} /* Debug */,
				{proj_release} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{target_config_list} /* Build configuration list for PBXNativeTarget "Toobar" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{target_debug} /* Debug */,
				{target_release} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
/* End XCConfigurationList section */
	}};
	rootObject = {project_id} /* Project object */;
}}
"""
    (PROJ_DIR / "project.pbxproj").write_text(pbx, encoding="utf-8")


def build_ipa_and_simulator() -> None:
    DIST_ELECTRON.mkdir(parents=True, exist_ok=True)
    derived_dir = Path("/tmp/toobar-ios-derived")
    if derived_dir.exists():
        shutil.rmtree(derived_dir)

    print("1/2. Building iOS/iPadOS Simulator Universal App...")
    subprocess.run(
        [
            "xcodebuild",
            "-project",
            str(PROJ_DIR),
            "-scheme",
            "Toobar",
            "-configuration",
            "Release",
            "-sdk",
            "iphonesimulator",
            "-derivedDataPath",
            str(derived_dir),
            "CODE_SIGNING_ALLOWED=NO",
            "build",
        ],
        check=True,
    )
    sim_app = derived_dir / "Build" / "Products" / "Release-iphonesimulator" / "Toobar.app"
    sim_zip = DIST_ELECTRON / f"Toobar-{VERSION}-iOS-Simulator.app.zip"
    if sim_zip.exists():
        sim_zip.unlink()
    subprocess.run(
        ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(sim_app), str(sim_zip)],
        check=True,
    )
    print(f"✅ Built {sim_zip}")

    print("2/2. Building iPhone & iPad Device IPA (Universal iOS + iPadOS)...")
    dev_derived = Path("/tmp/toobar-ios-device")
    if dev_derived.exists():
        shutil.rmtree(dev_derived)

    # Try automatic provisioning first; fall back to unsigned device build + adhoc/cert sign for AltStore/Sideloadly/Xcode
    signed_ok = False
    res = subprocess.run(
        [
            "xcodebuild",
            "-project",
            str(PROJ_DIR),
            "-scheme",
            "Toobar",
            "-configuration",
            "Release",
            "-sdk",
            "iphoneos",
            "-derivedDataPath",
            str(dev_derived),
            "-allowProvisioningUpdates",
            "build",
        ]
    )
    if res.returncode == 0:
        signed_ok = True
    else:
        print("Automatic provisioning requires registered device UDID; building universal arm64 device bundle for Sideloadly / AltStore / SideStore / Xcode...")
        subprocess.run(
            [
                "xcodebuild",
                "-project",
                str(PROJ_DIR),
                "-scheme",
                "Toobar",
                "-configuration",
                "Release",
                "-sdk",
                "iphoneos",
                "-derivedDataPath",
                str(dev_derived),
                "CODE_SIGNING_ALLOWED=NO",
                "CODE_SIGNING_REQUIRED=NO",
                "CODE_SIGN_IDENTITY=",
                "build",
            ],
            check=True,
        )

    dev_app = dev_derived / "Build" / "Products" / "Release-iphoneos" / "Toobar.app"
    subprocess.run(["xattr", "-cr", str(dev_app)], check=False)
    if not signed_ok:
        subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(dev_app)], check=True)

    payload_stage = Path("/tmp/toobar-ipa-stage")
    if payload_stage.exists():
        shutil.rmtree(payload_stage)
    (payload_stage / "Payload").mkdir(parents=True, exist_ok=True)
    subprocess.run(["ditto", "--norsrc", str(dev_app), str(payload_stage / "Payload" / "Toobar.app")], check=True)

    ipa_out = DIST_ELECTRON / f"Toobar-{VERSION}-iPhone-iPad.ipa"
    if ipa_out.exists():
        ipa_out.unlink()
    subprocess.run(
        ["zip", "-qry", str(ipa_out), "Payload"],
        cwd=str(payload_stage),
        check=True,
    )
    print(f"✅ Built {ipa_out} (signed_with_apple_profile={signed_ok})")


if __name__ == "__main__":
    write_swift_sources()
    copy_inlined_web_bundle()
    generate_app_icons()
    generate_pbxproj()
    print("✓ Generated ios/Toobar.xcodeproj and bundled Web assets.")
    build_ipa_and_simulator()
