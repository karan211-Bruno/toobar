import SwiftUI
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
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        if let wv = webView {
            let js = "window.__toobarHandleDeepLink && window.__toobarHandleDeepLink('\(raw)');"
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
            let js = "setTimeout(function(){ window.__toobarHandleDeepLink && window.__toobarHandleDeepLink('\(pending)'); }, 400);"
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
            source: "window.__toobarNativePlatform = '\(platformTag)';",
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
