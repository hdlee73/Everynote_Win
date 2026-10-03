# PDF Note for Windows

안드로이드 앱 [PDF Note](https://github.com/hdlee73/PDF-Note) v1.26.0과 **같은 화면·같은 기능**을 Windows에서 쓰도록 만든 버전입니다.
갤럭시 북 플렉스, 서피스 같은 펜 지원 노트북을 대상으로 합니다.

## 기능 (안드로이드와 동일)
- iOS 스타일 화면, 탭, 문서함(폴더·휴지통·즐겨찾기), 두 쪽 보기, **페이지 넘김 애니메이션(종이 말림/슬라이드)**
- **PDF, HWP, DOC/DOCX, PPT/PPTX, XLS/XLSX 불러오기** (HWP는 내장 엔진, 나머지는 설치된 MS Office 또는 LibreOffice로 PDF 변환)
- 펜 필기·형광펜·지우개·올가미, 글자 선택(하이라이트·메모·번역·읽어주기·사전), 타이핑·이미지·스티커·도형·표·링크 삽입, 녹음
- 검색(스캔본은 Windows OCR), 학습 패널(오답/단어 정리 내보내기), 북마크·개요·썸네일, 주석 포함 PDF/JSON 내보내기
- 안드로이드 백업(JSON)과 호환

## 설치
Releases에서 `PDF-Note-*-win-x64.exe`(ARM 노트북은 `win-arm64`)를 받아 실행합니다. 설치 불필요(단일 파일).
Windows 10/11, WebView2 런타임 필요(Windows 11에는 기본 포함).

## 구조
`web/` HTML/JS 앱(안드로이드 클래스를 같은 이름으로 이식) + `host/` WPF·WebView2 셸(파일·변환·OCR). 자세한 내용은 `docs/`.
