# Everynote

안드로이드 앱 [PDF Note](https://github.com/hdlee73/PDF-Note)와 **같은 화면·같은 기능**을 Windows에서 쓰도록 만든 노트 앱입니다. (이전 이름: PDF Note for Windows)
갤럭시 북 플렉스, 서피스 같은 펜 지원 노트북과 일반 노트북·데스크톱(마우스·키보드)을 모두 지원합니다.

## 기능
- iOS 스타일 화면, 탭, 문서함(폴더·휴지통·즐겨찾기), 두 쪽 보기, **페이지 넘김 애니메이션(종이 말림/슬라이드)**
- **PDF, HWP/HWPX, DOC/DOCX, PPT/PPTX, XLS/XLSX 불러오기** (HWP는 내장 엔진, 나머지는 설치된 MS Office 또는 LibreOffice로 PDF 변환)
- 펜 필기·형광펜·지우개·올가미, 글자 선택(하이라이트·메모·번역·읽어주기·사전), 타이핑·이미지·스티커·도형·표·링크 삽입, 녹음
- 검색(스캔본은 Windows OCR), 학습 패널(오답/단어 정리 내보내기), 북마크·개요·썸네일, 주석 포함 PDF/JSON 내보내기, **인쇄**
- 마우스 사용: 휠·가장자리 클릭·방향키·드래그로 페이지 넘기기, Ctrl+휠 확대/축소, 왼쪽 가장자리의 확대 버튼(＋ / 100% / －), 오른쪽 아래 ‘페이지 추가’ 버튼
- 옆 패널(미리보기·학습)의 너비를 구분선 드래그로 조절, 문서 영역과 구분되는 어두운 배경과 종이 그림자
- 글상자 서식: 정렬(왼쪽/가운데/오른쪽), 글머리표(점·번호·체크리스트), 밑줄 등. 삽입한 도형·이미지는 핸들로 크기를 조절하고 삭제 버튼으로 지울 수 있음
- 쓰기 도구는 삼성 노트처럼 아이콘으로 표시
- 안드로이드 백업(JSON)과 호환

## 설치
[Releases](https://github.com/hdlee73/pdf-note-windows/releases)에서 받습니다.

| 파일 | 설명 |
|---|---|
| `Everynote-Setup-vX.Y.Z-x64.exe` | **설치 프로그램(권장)** — 일반 PC (Intel/AMD) |
| `Everynote-Setup-vX.Y.Z-arm64.exe` | 설치 프로그램 — ARM 노트북 (Surface Pro X, Snapdragon 등) |
| `Everynote-vX.Y.Z-win-x64.exe` / `-win-arm64.exe` | 설치 없이 실행하는 단일 파일(포터블) |

설치 방법
1. `Everynote-Setup-…exe`를 실행합니다. 언어는 Windows 언어에 맞춰 한국어/영어로 표시됩니다.
2. 기본값은 **내 계정에만 설치**(`%LOCALAPPDATA%\Programs\Everynote`)이며 관리자 권한이 필요 없습니다. 모든 사용자용으로 설치하려면 설치 시작 때 나오는 선택 창에서 ‘모든 사용자’를 고르세요.
3. 추가 작업 선택: **바탕 화면 바로 가기**, ‘PDF·HWP·Office 문서에 **Everynote로 열기** 추가’(기본 앱은 바뀌지 않으며, 기본 앱으로 쓰려면 Windows 설정 > 앱 > 기본 앱에서 직접 지정).
4. 시작 메뉴에 Everynote가 만들어집니다. 시작 메뉴/바탕 화면 아이콘을 우클릭 > **작업 표시줄에 고정**하세요.
5. 실행 중인 Everynote가 있으면 설치/제거 때 자동으로 닫힙니다.

제거: Windows 설정 > 앱 > 설치된 앱 > Everynote > 제거. **내 문서와 설정은 기본으로 남겨 둡니다.** 제거 중 묻는 창에서 ‘예’를 고르면 설정·캐시(`%LOCALAPPDATA%\PDFNote`)를 지우고, 한 번 더 확인한 뒤에만 문서 폴더(`문서\PDF Note`)까지 지웁니다.
자동 설치(조용히): `Everynote-Setup-….exe /VERYSILENT /TASKS="desktopicon"`, 제거는 `"%LOCALAPPDATA%\Programs\Everynote\unins000.exe" /VERYSILENT` (`/PURGEDATA`로 설정까지 삭제).

요구 사항: Windows 10(1809 이상)/11, **WebView2 런타임**(Windows 11과 최신 Windows 10에는 기본 포함. 없으면 실행할 때 안내 창이 열립니다).
저장 위치(안드로이드·이전 버전과 같음): 문서 `문서\PDF Note`, 설정·캐시 `%LOCALAPPDATA%\PDFNote`.

## 오프라인(인터넷이 막힌 사내망)에서 제한되는 기능
Everynote의 핵심 기능은 **인터넷 없이 모두 동작**합니다: 문서 열기, 펜·타이핑·도형 편집, 검색, 북마크, 녹음, 인쇄, 내보내기, HWP 변환(내장 엔진), 스캔본 OCR(Windows OCR), 읽어주기(Windows에 설치된 음성).

| 기능 | 오프라인에서 | 비고 |
|---|---|---|
| 번역(글자 선택 > 번역) | 사용 불가 | 기본 브라우저로 Google 번역 페이지를 엽니다. |
| 사전(글자 선택 > 사전) | 사용 불가 | 기본 브라우저로 네이버 사전을 엽니다. |
| 유튜브 영상 링크·미리보기 | 사용 불가 | 삽입한 영상의 썸네일과 재생은 인터넷이 필요합니다. |
| 읽어주기 | 일부 | ‘Microsoft … Online (Natural)’ 같은 온라인 음성은 인터넷이 필요합니다. 설정 > 시간 및 언어 > 음성에서 설치하는 오프라인 음성을 쓰세요. |
| 스캔본 OCR | 언어 팩 필요 | Windows 설정에서 한국어/영어 OCR 언어 팩이 설치되어 있어야 합니다(설치 때만 인터넷 필요). |
| DOC/PPT/XLS 변환 | 조건부 | PC에 MS Office 또는 LibreOffice가 설치되어 있어야 합니다(인터넷 불필요). HWP/HWPX는 내장 엔진이라 항상 가능합니다. |
| WebView2 런타임 설치 | 설치 때만 | 사내망에서는 Microsoft의 *Evergreen Standalone Installer*(오프라인용)를 미리 설치하세요. |
| 앱 링크(웹 주소 열기) | 사용 불가 | 문서 속 링크는 기본 브라우저로 열립니다. |

Everynote는 자동 업데이트나 사용 통계 전송을 하지 않습니다. 인터넷에 접속하는 것은 위 표의 기능을 직접 사용할 때뿐입니다.

## 구조
`web/` HTML/JS 앱(안드로이드 클래스를 같은 이름으로 이식) + `host/` WPF·WebView2 셸(파일·변환·OCR) + `installer/` Inno Setup 설치 프로그램. 빌드/CI는 `.github/workflows/build.yml`, 자세한 내용은 `docs/`.
아이콘은 `web/assets/everynote-icon.svg`에서 `python tools/make_icons.py`로 만듭니다.
