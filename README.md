# PDF Note for Windows

[PDF Note](https://github.com/hdlee73/PDF-Note)(Android)의 **Windows 버전**입니다.
갤럭시 북 플렉스, 서피스 같은 **펜 지원 노트북**에서 PDF를 읽고, 펜으로 필기하고, 하이라이트·메모를 남기도록 만들었습니다.
저사양 PC에서도 가볍게 돌아가도록 Windows 내장 PDF 엔진을 쓰고, 필요한 페이지만 그립니다.

## 주요 기능

| 구분 | 내용 |
|---|---|
| 문서 | PDF 열기(파일 선택·끌어다 놓기·더블클릭), 여러 문서 **탭**, 최근 문서, 문서함, 이어 읽기(마지막 페이지 기억) |
| 필기 | **펜 필압 필기**, 형광펜, 획 지우개(펜 뒷면=지우개), **올가미 선택·이동·삭제**, 실행 취소/다시 실행, 5색 팔레트·굵기 조절 |
| 터치 | 손가락 필기 켜기/끄기(끄면 손가락은 스크롤·핀치 확대, 펜만 필기), 두 손가락 확대, 좌우 스와이프 페이지 넘김 |
| 글자 | 글자 선택(드래그) → **하이라이트·메모 달린 하이라이트·복사·번역·읽어주기·사전 검색·개요 추가** |
| 스캔본 | 글자 레이어가 없는 PDF는 Windows 내장 **OCR**로 글자 인식 (OCR 언어 팩 필요) |
| 메모 | 포스트잇 메모(이동·접기·삭제), 하이라이트별 메모, 메모 숨기기 |
| 탐색 | 페이지 썸네일, 개요(PDF 목차 + 내가 만든 개요), 즐겨찾기, 페이지 번호 이동, 문서 내 검색(메모 포함) |
| 노트 | **새 노트**(백지·줄노트·모눈, 6가지 배경색, 마지막 장에서 넘기면 페이지 자동 추가) |
| 내보내기 | **필기·하이라이트·메모가 합쳐진 PDF**, Markdown / CSV / Anki(TSV), 영역 캡처(이미지 복사·PNG 저장) |
| 백업 | 문서별 주석 자동 저장, 주석 JSON 백업·복원 (원본 PDF는 절대 수정하지 않음) |
| 기타 | 전체 화면(F11), 절약 모드(저사양), 완전 오프라인 처리 |

## 설치

[Releases](https://github.com/hdlee73/PDF-Note-Windows/releases)에서 받으세요.

- `PDFNote-…-win-x64.exe` — **대부분의 PC(갤럭시 북 플렉스, 서피스 프로/랩톱 등)**. 설치 없이 실행, .NET 설치 불필요.
- `PDFNote-…-win-arm64.exe` — ARM 기기(서피스 프로 X 등).
- `PDFNote-…-win-x64-lite(needs-.NET8-Desktop-Runtime).exe` — 용량이 작은 버전. [.NET 8 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/8.0)이 설치되어 있어야 합니다.

> 서명되지 않은 앱이라 처음 실행할 때 Windows SmartScreen 경고가 나올 수 있습니다. "추가 정보 → 실행"을 누르세요.
> 첫 실행은 압축을 푸느라 몇 초 걸리고, 이후에는 빠르게 열립니다.

**요구 사항:** Windows 10 (1809) 이상 · 암호화되지 않은 PDF

## 사용 팁

- 위쪽 도구 막대에서 **이동 / 펜 / 형광펜 / 지우개 / 올가미 / 글자선택 / 메모 / 개요+ / 캡처**를 고릅니다. `Esc`는 이동 모드로 돌아옵니다.
- 펜 모드에서 손가락으로 화면이 스크롤되게 하려면 **손가락 필기**를 꺼 두세요(기본값). 손바닥이 닿아도 잘못 그려지지 않습니다.
- 마지막 장에서 다음 페이지로 넘기면 **노트**는 새 장이 추가됩니다.
- 스캔본 PDF의 글자 선택·검색 정확도는 Windows에 설치된 OCR 언어에 따라 달라집니다. (설정 → 시간 및 언어 → 언어 및 지역 → 언어 추가)
- 읽어주기는 Windows에 설치된 음성(TTS)을 씁니다. 메뉴 → 읽어주기 음성에서 영어(미국/영국/호주) 등을 고를 수 있습니다.

### 단축키

| 키 | 동작 |
|---|---|
| `PageDown` `→` / `PageUp` `←` | 다음 / 이전 페이지 |
| `Ctrl` + 휠 · `Ctrl` + `+` `-` | 확대 / 축소 |
| `Ctrl` + `0` | 폭 맞춤 |
| `Ctrl` + `Z` / `Ctrl` + `Y` | 실행 취소 / 다시 실행 |
| `Ctrl` + `F` / `Ctrl` + `G` | 검색 / 페이지 이동 |
| `Ctrl` + `O` / `N` / `W` | 열기 / 새 노트 / 탭 닫기 |
| `F11` | 전체 화면 |

## 저장 위치

- 주석: `%APPDATA%\PDFNote\annotations\` (문서 내용 기준으로 저장되어 파일 이름을 바꿔도 유지됩니다)
- 새 노트·문서함: `문서\PDF Note\`
- 모든 처리는 PC 안에서만 이뤄지며, 번역/사전 검색을 선택할 때만 브라우저가 열립니다.

## Android 앱과 다른 점

Android 버전의 일부 기능은 Windows에서 아직 지원하지 않습니다.

- HWP·HWPX·DOC·DOCX·PPT·PPTX·XLS 자동 변환 → 해당 프로그램에서 PDF로 저장한 뒤 여세요.
- 두 쪽 보기, 듀얼 뷰 노트 화면, 문서함 폴더 트리·휴지통
- 원본 PDF 안에 주석을 직접 삽입하지 않습니다(Android 앱과 동일). 다른 앱에서 보려면 **PDF로 내보내기**를 쓰세요.

## 빌드

```powershell
dotnet publish src/PDFNote.csproj -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o out
```

`v`로 시작하는 태그(예: `v1.0.0`)를 push하면 GitHub Actions가 x64 / ARM64 / lite 실행 파일을 빌드해 Release를 만듭니다.

기술 구성: .NET 8 · WPF · Windows.Data.Pdf(렌더링) · PdfPig(글자 레이어) · Windows.Media.Ocr · InkCanvas(필압 필기)

## 라이선스

MIT — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 참고
