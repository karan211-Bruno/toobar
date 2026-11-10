# Toobar (투바)

macOS, Windows, Ubuntu(Linux)를 지원하는 크로스 플랫폼 화상 회의 및 실시간 문서(PDF)·화이트보드 협업 데스크톱 애플리케이션입니다.

## 주요 기능

- **실시간 화상 회의 (WebRTC + 내장 시그널링/LAN 브리지)**
  - 별도 외부 서버 설치 없이 앱 실행 즉시 시그널링(`3002`), 초대/라이브 업데이트(`3001`), LAN 자동 탐색(`41234/UDP`) 지원
  - `toobar://join?meetingId=...` 딥링크 및 브라우저 원클릭 초대 페이지 지원
- **PDF 동시 열람 및 실시간 판서 협업 (`CollaborationStage`)**
  - PDF 문서 업로드 및 청크 분할 전송으로 대용량 PDF도 모든 참가자와 즉시 동기화
  - 호스트 권한 이전 시에도 기존에 열려 있던 PDF 문서·페이지·판서 레이어 완벽 유지
  - 펜, 형광펜, 레이저 포인터, 지우개 실시간 동기화
- **무설치 라이브 업데이트 (`Live Update`)**
  - 앱 재설치 없이 프로그램 내 **업데이트** 버튼 또는 자동 업데이트로 최신 UI·렌더러 번들을 즉시 핫리로드 적용
- **참가자 및 미디어 제어**
  - 호스트/참가자 양방향 마이크 음소거, 비디오 중지, 화면 공유(시스템 오디오 포함), 전체/귓속말 채팅 및 파일 첨부

## 설치 파일 안내 (v1.0.0)

GitHub Releases에서 운영체제에 맞는 설치 파일을 다운로드할 수 있습니다:

| 운영체제 | 파일명 | 설명 |
|---|---|---|
| **Windows (x64)** | `Toobar Setup 1.0.0.exe` | 설치 마법사 버전 (바탕화면/시작 메뉴 바로가기 생성, 권장) |
| **Windows (x64)** | `Toobar 1.0.0.exe` | 무설치 포터블 단일 실행 파일 |
| **Windows (x64)** | `Toobar-1.0.0-win.zip` | 무설치 압축 해제형 패키지 |
| **Ubuntu / Debian (amd64)** | `Toobar_1.0.0_amd64.deb` | Ubuntu 20.04 / 22.04 / 24.04 LTS 호환 패키지 (`sudo apt install ./Toobar_1.0.0_amd64.deb`) |
| **Linux (x86_64)** | `Toobar-1.0.0.AppImage` | 무설치 AppImage (`chmod +x` 후 실행) |
| **macOS (Apple Silicon)** | `Toobar-1.0.0-arm64.pkg` | 자동 설치 패키지 (Gatekeeper 검역 자동 해제 포함) |
| **macOS (Apple Silicon)** | `Toobar-1.0.0-arm64.dmg` | 디스크 이미지 인스톨러 |
| **macOS (Apple Silicon)** | `Toobar-1.0.0-arm64-mac.zip` | 앱 번들 압축본 |

## 개발 및 빌드 방법

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev

# 전체 빌드 (TypeScript + Vite + Live Update 번들 생성)
npm run build
```
