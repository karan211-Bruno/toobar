package com.toobar.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQ_PERMISSIONS = 1001;
    private static final int REQ_FILE_CHOOSER = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingDeepLink;
    private boolean pageLoaded = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                window.setStatusBarColor(0xFF0B0F19);
                window.setNavigationBarColor(0xFF0B0F19);
            }
        }

        requestMediaPermissionsIfNeeded();

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF0B0F19);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.addJavascriptInterface(new ToobarJsBridge(), "ToobarAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                if (pendingDeepLink != null) {
                    final String link = pendingDeepLink;
                    pendingDeepLink = null;
                    dispatchDeepLinkToJs(link);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                            if (am != null) {
                                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                                am.setSpeakerphoneOn(true);
                            }
                        } catch (Exception ignored) {}
                        request.grant(request.getResources());
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(Intent.createChooser(intent, "전송할 파일 선택"), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        handleIncomingIntent(getIntent());
        loadBundledApp();
    }

    private void loadBundledApp() {
        try {
            InputStream is = getAssets().open("www/index.html");
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            is.close();
            String html = new String(baos.toByteArray(), StandardCharsets.UTF_8);
            // Load under https://app.toobar.local/ so WebRTC getUserMedia & localStorage run in a Secure Context
            webView.loadDataWithBaseURL("https://app.toobar.local/", html, "text/html", "UTF-8", null);
        } catch (Exception e) {
            Toast.makeText(this, "앱 로딩 오류: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void requestMediaPermissionsIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> needed = new ArrayList<String>();
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.CAMERA);
            }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
            if (Build.VERSION.SDK_INT >= 31) {
                if (checkSelfPermission("android.permission.BLUETOOTH_CONNECT") != PackageManager.PERMISSION_GRANTED) {
                    needed.add("android.permission.BLUETOOTH_CONNECT");
                }
            }
            if (!needed.isEmpty()) {
                requestPermissions(needed.toArray(new String[0]), REQ_PERMISSIONS);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null) {
            String raw = data.toString();
            if (pageLoaded && webView != null) {
                dispatchDeepLinkToJs(raw);
            } else {
                pendingDeepLink = raw;
            }
        }
    }

    private void dispatchDeepLinkToJs(String rawUrl) {
        final String escaped = rawUrl.replace("\\", "\\\\").replace("'", "\\'");
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(
                        "window.__toobarHandleDeepLink && window.__toobarHandleDeepLink('" + escaped + "');",
                        null
                    );
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                ClipData clipData = data.getClipData();
                if (clipData != null && clipData.getItemCount() > 0) {
                    results = new Uri[clipData.getItemCount()];
                    for (int i = 0; i < clipData.getItemCount(); i++) {
                        results[i] = clipData.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    public class ToobarJsBridge {
        @JavascriptInterface
        public void saveBase64File(final String base64Data, final String fileName, final String mimeType) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                        String safeName = (fileName == null || fileName.trim().isEmpty())
                                ? ("toobar-" + System.currentTimeMillis())
                                : fileName.replaceAll("[\\/:*?\"<>|]", "_");
                        String safeMime = (mimeType == null || mimeType.isEmpty())
                                ? "application/octet-stream"
                                : mimeType;

                        // 1. Save directly into Downloads on Android 10+ via MediaStore
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            ContentValues values = new ContentValues();
                            values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                            values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Toobar");
                            ContentResolver resolver = getContentResolver();
                            Uri downloadUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                            if (downloadUri != null) {
                                OutputStream os = resolver.openOutputStream(downloadUri);
                                if (os != null) {
                                    os.write(bytes);
                                    os.flush();
                                    os.close();
                                }
                            }
                        }

                        // 2. Also cache & open Android Share / Open sheet via SimpleFileProvider
                        File shareDir = new File(getCacheDir(), "shared_files");
                        if (!shareDir.exists()) shareDir.mkdirs();
                        File outFile = new File(shareDir, safeName);
                        FileOutputStream fos = new FileOutputStream(outFile);
                        fos.write(bytes);
                        fos.flush();
                        fos.close();

                        Toast.makeText(MainActivity.this, "파일 저장됨 (Downloads/Toobar): " + safeName, Toast.LENGTH_LONG).show();

                        Uri contentUri = SimpleFileProvider.getUriForFile(outFile);
                        Intent shareIntent = new Intent(Intent.ACTION_SEND);
                        shareIntent.setType(safeMime);
                        shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(shareIntent, safeName));
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "파일 저장 오류: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            });
        }
    }
}
