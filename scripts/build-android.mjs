import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const pkgJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const version = pkgJson.version || '1.1.0';

const JAVA_HOME = '/Users/newborn/Library/Java/JavaVirtualMachines/jbr-17.0.14/Contents/Home';
const ANDROID_SDK = '/Users/newborn/Library/Android/sdk';
const BUILD_TOOLS = join(ANDROID_SDK, 'build-tools/34.0.0');
const ANDROID_JAR = join(ANDROID_SDK, 'platforms/android-34/android.jar');

const JAVAC = join(JAVA_HOME, 'bin/javac');
const KEYTOOL = join(JAVA_HOME, 'bin/keytool');
const AAPT2 = join(BUILD_TOOLS, 'aapt2');
const D8 = join(BUILD_TOOLS, 'd8');
const ZIPALIGN = join(BUILD_TOOLS, 'zipalign');
const APKSIGNER = join(BUILD_TOOLS, 'apksigner');

const androidDir = join(rootDir, 'android');
const srcJavaDir = join(androidDir, 'app/src/main/java/com/toobar/app');
const resDir = join(androidDir, 'app/src/main/res');
const assetsWwwDir = join(androidDir, 'app/src/main/assets/www');
const manifestPath = join(androidDir, 'app/src/main/AndroidManifest.xml');
const distElectron = join(rootDir, 'dist-electron');

console.log('1. Preparing Android native project structure (android/)...');
rmSync(join(androidDir, 'build'), { recursive: true, force: true });
mkdirSync(srcJavaDir, { recursive: true });
mkdirSync(assetsWwwDir, { recursive: true });
mkdirSync(distElectron, { recursive: true });

// Generate mipmap launcher icons from public/icon.png
const iconSrc = join(rootDir, 'public/icon.png');
const mipmapSpecs = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];
for (const [folder, px] of mipmapSpecs) {
  const dir = join(resDir, folder);
  mkdirSync(dir, { recursive: true });
  const outPng = join(dir, 'ic_launcher.png');
  execSync(`sips -z ${px} ${px} "${iconSrc}" --out "${outPng}" >/dev/null 2>&1`);
}

mkdirSync(join(resDir, 'values'), { recursive: true });
writeFileSync(
  join(resDir, 'values/strings.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Toobar</string>
</resources>
`,
  'utf8'
);

// Inline CSS & JS + __toobarNativePlatform='android' into assets/www/index.html
const cssText = readFileSync(join(rootDir, 'dist/renderer/assets/main.css'), 'utf8');
const jsText = readFileSync(join(rootDir, 'dist/renderer/assets/main.js'), 'utf8');
const safeJs = jsText.replace(/<\/script/gi, '<\\/script');

const inlineHtml =
  '<!doctype html><html lang="ko"><head><meta charset="UTF-8" />' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />' +
  "<script>window.__toobarNativePlatform='android';</script>" +
  '<title>Toobar</title><style>' +
  cssText +
  '</style></head><body><div id="root"></div><script type="module">' +
  safeJs +
  '</script></body></html>';

writeFileSync(join(assetsWwwDir, 'index.html'), inlineHtml, 'utf8');

// Write AndroidManifest.xml
writeFileSync(
  manifestPath,
  `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.toobar.app"
    android:versionCode="110"
    android:versionName="${version}">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />

    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.DeviceDefault.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|uiMode"
            android:windowSoftInputMode="adjustResize">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="toobar" />
                <data android:scheme="zoomclone" />
            </intent-filter>
        </activity>

        <provider
            android:name=".SimpleFileProvider"
            android:authorities="com.toobar.app.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true" />
    </application>
</manifest>
`,
  'utf8'
);

// Write SimpleFileProvider.java (zero-dependency ContentProvider for sharing downloaded files/PDFs/images)
writeFileSync(
  join(srcJavaDir, 'SimpleFileProvider.java'),
  `package com.toobar.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import java.io.File;
import java.io.FileNotFoundException;

public class SimpleFileProvider extends ContentProvider {
    public static final String AUTHORITY = "com.toobar.app.fileprovider";

    public static Uri getUriForFile(File file) {
        return new Uri.Builder()
                .scheme("content")
                .authority(AUTHORITY)
                .appendPath(file.getName())
                .build();
    }

    private File resolveSharedFile(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null) name = "file";
        File dir = new File(getContext().getCacheDir(), "shared_files");
        return new File(dir, name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file = resolveSharedFile(uri);
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) {
                row[i] = file.getName();
            } else if (OpenableColumns.SIZE.equals(cols[i])) {
                row[i] = file.length();
            }
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name != null && name.contains(".")) {
            String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (mime != null) return mime;
        }
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = resolveSharedFile(uri);
        if (!file.exists()) throw new FileNotFoundException(file.getAbsolutePath());
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }
}
`,
  'utf8'
);

// Write MainActivity.java
writeFileSync(
  join(srcJavaDir, 'MainActivity.java'),
  `package com.toobar.app;

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
        final String escaped = rawUrl.replace("\\\\", "\\\\\\\\").replace("'", "\\\\'");
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
                                : fileName.replaceAll("[\\\\/:*?\\"<>|]", "_");
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
`,
  'utf8'
);

console.log('2. Compiling Android resources with aapt2...');
const buildWork = '/tmp/toobar-android-build';
rmSync(buildWork, { recursive: true, force: true });
mkdirSync(join(buildWork, 'compiled_res'), { recursive: true });
mkdirSync(join(buildWork, 'gen'), { recursive: true });
mkdirSync(join(buildWork, 'classes'), { recursive: true });
mkdirSync(join(buildWork, 'dex'), { recursive: true });

execSync(
  `"${AAPT2}" compile --dir "${resDir}" -o "${join(buildWork, 'compiled_res/res.zip')}"`,
  { stdio: 'inherit' }
);

const unalignedApk = join(buildWork, 'toobar-unaligned.apk');
execSync(
  `"${AAPT2}" link -o "${unalignedApk}" -I "${ANDROID_JAR}" --manifest "${manifestPath}" -A "${join(androidDir, 'app/src/main/assets')}" --java "${join(buildWork, 'gen')}" --min-sdk-version 24 --target-sdk-version 34 "${join(buildWork, 'compiled_res/res.zip')}"`,
  { stdio: 'inherit' }
);

console.log('3. Compiling Java sources & R.java with JDK 17 + d8...');
const rJava = join(buildWork, 'gen/com/toobar/app/R.java');
execSync(
  `"${JAVAC}" -source 8 -target 8 -encoding UTF-8 -bootclasspath "${ANDROID_JAR}" -classpath "${ANDROID_JAR}" -d "${join(buildWork, 'classes')}" "${rJava}" "${join(srcJavaDir, 'SimpleFileProvider.java')}" "${join(srcJavaDir, 'MainActivity.java')}"`,
  { stdio: 'inherit' }
);

// Package compiled .class files into classes.jar so inner classes ($1, $2) are never mangled by shell expansion
const JAR = join(JAVA_HOME, 'bin/jar');
const classesJar = join(buildWork, 'classes.jar');
execSync(`"${JAR}" cf "${classesJar}" -C "${join(buildWork, 'classes')}" .`, {
  stdio: 'inherit',
});

execSync(
  `JAVA_HOME="${JAVA_HOME}" "${D8}" --lib "${ANDROID_JAR}" --min-api 24 --output "${join(buildWork, 'dex')}" "${classesJar}"`,
  { stdio: 'inherit' }
);

// Add classes.dex to the root of unalignedApk
execSync(`cd "${join(buildWork, 'dex')}" && zip -q -u "${unalignedApk}" classes.dex`, {
  stdio: 'inherit',
});

console.log('4. Aligning & signing Toobar APK (v1 + v2 + v3 signatures)...');
const alignedApk = join(buildWork, 'toobar-aligned.apk');
execSync(`"${ZIPALIGN}" -f -p 4 "${unalignedApk}" "${alignedApk}"`, { stdio: 'inherit' });

const keystorePath = join(androidDir, 'toobar-release.keystore');
if (!existsSync(keystorePath)) {
  execSync(
    `"${KEYTOOL}" -genkeypair -v -keystore "${keystorePath}" -alias toobar -keyalg RSA -keysize 2048 -validity 10000 -storepass toobar123 -keypass toobar123 -dname "CN=Toobar, OU=Mobile, O=Toobar Team, L=Seoul, S=Seoul, C=KR"`,
    { stdio: 'inherit' }
  );
}

const finalApk = join(distElectron, `Toobar-${version}-android.apk`);
if (existsSync(finalApk)) rmSync(finalApk);
execSync(
  `JAVA_HOME="${JAVA_HOME}" "${APKSIGNER}" sign --ks "${keystorePath}" --ks-key-alias toobar --ks-pass pass:toobar123 --key-pass pass:toobar123 --out "${finalApk}" "${alignedApk}"`,
  { stdio: 'inherit' }
);
execSync(`JAVA_HOME="${JAVA_HOME}" "${APKSIGNER}" verify "${finalApk}"`, { stdio: 'inherit' });

console.log(`✅ Built and verified Android APK: ${finalApk}`);
