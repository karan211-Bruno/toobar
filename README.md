# Toobar (투바) v1.1.0

**맥북(macOS) · 아이폰(iOS) · 아이패드(iPadOS) · 윈도우(Windows) · 우분투(Ubuntu Linux) · 안드로이드(Android)** 등 6대 모든 플랫폼을 아우르는 통합 화상 회의 · 실시간 문자 메신저 · 파일 공유 프로그램입니다.

---

## 주요 기능 (v1.1.0)

### 1. 회의 전/후 언제나 쓰는 **실시간 문자 메신저 & 파일 공유 (`💬 문자 · 파일`)**
- 화상 회의에 들어가지 않아도 프로그램을 켜자마자 **Toobar 사용자끼리 실시간으로 문자와 파일을 주고받을 수 있습니다.**
- **고유 사용자 코드 (`TB-XXXX`) 자동 발급**: 별도 회원가입 없이 기기별 고유 코드가 부여되며, 실시간 접속자 목록에서 클릭 한 번으로 **1:1 대화**, **전체 라운지**, **#그룹방** 대화를 나눌 수 있습니다.
- **모든 파일 전송 및 미리보기**: 사진, 동영상, 음성, PDF, 문서(HWPX/DOCX/XLSX), 압축 파일(.zip) 등 모든 파일을 드래그 앤 드롭, 클립보드 붙여넣기(`Cmd+V`/`Ctrl+V`), 또는 `📎` 버튼으로 전송하며 실시간 전송 진행률(`0% ~ 100%`)과 즉시 저장/공유 기능을 지원합니다.
- **원클릭 화상통화 걸기**: 문자 대화 도중 `📹 화상통화 걸기` 버튼을 누르면 대화방에 입장 버튼이 전송되어 상대방이 터치 한 번으로 화상 회의에 합류합니다.

### 2. 회의 중 채팅 & 파일 전송 + 협업 스테이지
- **회의 중 파일 공유**: 회의 채팅창에서도 전체 또는 특정 참가자(1:1 비공개)에게 문자와 파일을 전송하고 대화 기록을 `.txt`로 저장할 수 있습니다.
- **협업 콘텐츠 공유**:
  - 전체 화면 / 앱 창 공유 (시스템 오디오 포함)
  - 실시간 공동 **전자칠판 (화이트보드)** — 아이패드 Apple Pencil 및 스마트폰 터치 판서 완벽 지원
  - **프레젠테이션 슬라이드** 동기화 및 슬라이드 위 판서
  - **PDF 문서 동시 열람** 및 형광펜 판서 (데스크톱 및 모바일 뷰어/다운로드 지원)
  - **동영상(MP4/WebM) 및 고음질 음악(MP3/WAV)** 실시간 스트리밍
- **모바일 카메라 전·후면 전환 (`🔄 카메라 전환`)** 및 **실시간 회의 녹화 (`MediaRecorder`)** 지원

### 3. 서버 설정 없는 하이브리드 글로벌 + 로컬 브리지
- **데스크톱 ↔ 모바일 완벽 연동**: 데스크톱(TCP MQTT + 로컬 LAN UDP 브로드캐스트)과 모바일(WebSocket Secure MQTT + WebRTC STUN)이 동일한 글로벌 버스를 공유하여 같은 Wi-Fi는 물론 LTE/5G 외부 네트워크에서도 IP 설정 없이 서로 연결됩니다.
- **무설치 라이브 OTA 업데이트**: 데스크톱 버전에서는 `🔄 업데이트` 버튼 하나로 재설치 없이 최신 버전을 즉시 적용할 수 있습니다.

---

## 플랫폼별 설치 파일 안내

| 플랫폼 | 파일명 | 설치 및 실행 방법 |
| --- | --- | --- |
| **macOS (Apple Silicon 맥북/맥)** | `Toobar-1.1.0-arm64.pkg` / `.dmg` / `.zip` | `.pkg` 더블클릭 설치 또는 `.dmg` 내 `⚡ Toobar 원클릭 자동설치.command` 실행 |
| **iPhone & iPad (iOS / iPadOS 16+)** | `Toobar-1.1.0-iPhone-iPad.ipa` | AltStore / SideStore / Sideloadly / Apple Configurator 또는 `ios/Toobar.xcodeproj` Xcode 빌드 설치 |
| **Android (스마트폰 / 태블릿)** | `Toobar-1.1.0-android.apk` | 기기에서 `.apk` 파일을 내려받아 바로 설치 (`출처를 알 수 없는 앱 허용` 1회 승인) |
| **Windows 10 / 11 (64-bit)** | `Toobar Setup 1.1.0.exe` / `Toobar 1.1.0.exe` | 설치형(`Setup`) 실행 또는 무설치 포터블(`Toobar 1.1.0.exe`) 즉시 실행 |
| **Ubuntu / Debian Linux (64-bit)** | `Toobar_1.1.0_amd64.deb` / `Toobar-1.1.0.AppImage` | `sudo apt install ./Toobar_1.1.0_amd64.deb` 또는 `.AppImage` 실행 권한 부여 후 실행 |

---

## 개발 및 전체 플랫폼 빌드 명령어

```bash
# 의존성 설치
npm install

# TypeScript 검증 및 렌더러/메인/OTA 번들 빌드
npm run build

# 각 플랫폼별 패키지 빌드
npm run dist:mac       # macOS (.dmg, .pkg, .zip)
npm run dist:win       # Windows (Setup .exe, Portable .exe, .zip)
npm run dist:linux     # Ubuntu (.deb, .tar.gz)
npm run dist:ios       # iPhone & iPad Universal (.ipa, Simulator .app.zip)
npm run dist:android   # Android (.apk)
```
