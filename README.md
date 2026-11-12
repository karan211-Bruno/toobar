# Toobar (투바) v1.1.2

**맥북(macOS) · 아이폰(iOS) · 아이패드(iPadOS) · 윈도우(Windows) · 우분투(Ubuntu Linux) · 안드로이드(Android)** 등 6대 모든 플랫폼을 아우르는 통합 화상 회의 · 실시간 문자 메신저 · 파일 공유 프로그램입니다.

- **모바일·태블릿·웹 즉시 실행 주소 (설치 없이 바로 실행 / 홈 화면 추가 PWA)**:
  👉 **https://karan211-bruno.github.io/toobar/**

---

## v1.1.2 업데이트 내역 (내부 명칭 100% Toobar 일원화 및 구버전 자동 정리)

1. **내부 명칭 · 프로토콜 · 채널 · 저장소 100% `Toobar` 일원화**:
   - 실행 바이너리(`Toobar`), 번들 ID(`com.toobar.app`), 딥링크 스킴(`toobar://`), 글로벌 클라우드 버스 토픽(`toobar/v2/global_bus`), 로컬 설정 저장소까지 과거 `ZoomClone` 잔재를 완전히 제거하고 `Toobar`로 100% 통일했습니다.
2. **구버전 `ZoomClone` 잔존 앱 자동 제거 탑재**:
   - macOS(`.pkg`, `.dmg` 원클릭 설치), Windows(`Setup.exe`), Ubuntu(`.deb`) 설치 시 기존 PC/맥에 남아 있던 구버전 `ZoomClone` 앱과 바로가기를 자동으로 종료·언레지스터·삭제하여 구버전 충돌 팝업이 뜨지 않도록 개선했습니다.
3. **6대 플랫폼 실행 안정성 검증 완료 (v1.1.1 ~ v1.1.2)**:
   - macOS(`Toobar Helper` 및 `ElectronAsarIntegrity` 정합성 클린 빌드), Windows(`win-unpacked` 순정 PE 무결성 리소스 및 아이콘 언패킹), Ubuntu 24.04(`--no-sandbox` 내장), iPhone·iPad·Android(IIFE 번들 및 HTTPS PWA) 전 플랫폼 즉시 실행 확인 완료.

---

## 주요 기능

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

---

## 플랫폼별 설치 및 실행 방법 (필독)

| 플랫폼 | 파일명 | 설치 및 실행 방법 |
| --- | --- | --- |
| **macOS (Apple Silicon 맥북/맥)** | `Toobar-1.1.2-arm64.pkg` *(권장)* / `.dmg` / `.zip` | **권장**: `Toobar-1.1.2-arm64.pkg`를 우클릭 → **열기**로 설치하면 구버전 `ZoomClone.app` 자동 정리 및 보안 격리 해제까지 한 번에 완료되어 바로 실행됩니다. (만약 macOS에서 차단 메시지가 뜨면 **시스템 설정 → 개인정보 보호 및 보안 → 없이도 열기** 클릭) |
| **Windows 10 / 11 (64-bit)** | `Toobar Setup 1.1.2.exe` / `Toobar 1.1.2.exe` | 설치형(`Setup`) 또는 무설치 포터블(`Toobar 1.1.2.exe`) 실행. **Windows의 PC 보호(SmartScreen)** 파란 창이 뜨면 **추가 정보 → 실행**을 클릭하세요. |
| **Android (스마트폰 / 태블릿)** | `Toobar-1.1.2-android.apk` | 기기에서 `.apk` 파일을 눌러 설치 (**출처를 알 수 없는 앱 설치 허용** 및 Play 프로텍트 **무시하고 설치** 선택) |
| **iPhone & iPad (iOS / iPadOS)** | **웹앱(PWA)** *(가장 간편)* 또는 `Toobar-1.1.2-iPhone-iPad.ipa` | **방법 1 (즉시 실행 권장)**: Safari에서 `https://karan211-bruno.github.io/toobar/` 접속 → 하단/상단 **공유 버튼 → 홈 화면에 추가** 클릭<br>**방법 2 (.ipa 설치)**: PC/Mac에서 **Sideloadly / AltStore**로 `.ipa` 서명 설치 (아이폰 파일 앱에서 `.ipa`를 직접 누르면 Apple 정책상 실행되지 않습니다) |
| **Ubuntu / Debian Linux (64-bit)** | `Toobar_1.1.2_amd64.deb` / `Toobar-1.1.2.AppImage` | 터미널에서 `sudo apt install ./Toobar_1.1.2_amd64.deb` 실행 후 `toobar` 실행, 또는 `chmod +x Toobar-1.1.2.AppImage && ./Toobar-1.1.2.AppImage` |

---

## 개발 및 전체 플랫폼 빌드 명령어

```bash
npm install
npm run build          # TypeScript 검증 및 렌더러/메인/OTA 번들 빌드
npm run dist:mac       # macOS (.dmg, .pkg, .zip)
npm run dist:win       # Windows (Setup .exe, Portable .exe, .zip)
npm run dist:linux     # Ubuntu (.AppImage, .deb, .tar.gz)
npm run dist:ios       # iPhone & iPad Universal (.ipa, Simulator .app.zip)
npm run dist:android   # Android (.apk)
```
