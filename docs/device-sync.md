# 기기 동기화 (같은 Wi-Fi, 사용자 실행형, 문서 통째 덮어쓰기)

- 휴대폰(Android): 도구 → ‘다른 기기와 동기화’ → 주소·코드 표시 (창을 닫으면 서버 종료).
- PC: 도구 → ‘다른 기기와 동기화’ → 주소·코드 입력 → 방향(PC → 휴대폰 / 휴대폰 → PC)과 문서를 고르고 ‘덮어쓰기’.
- 선택한 문서의 PDF + 노트(sidecar JSON) + 참조된 이미지·녹음·동영상을 통째로 보내 받는 쪽의 같은 문서(문서함 상대 경로 기준)를 덮어씁니다. 없으면 새로 만듭니다. 삭제는 전달하지 않습니다.
- 열려 있는 문서는 덮어쓰지 않습니다(양쪽 모두). 평문 HTTP + 6자리 코드(10회 오류 시 잠김), 사설 IPv4만 허용.
- 구조: `web/js/sync.js`(로직) · `host/Bridge.cs net.http`(https 페이지는 http를 직접 못 부르므로 호스트가 요청) · Android `DeviceSync.java`.
- 테스트: `node dev/sync-test.mjs` (SYNC_PORT/SYNC_CODE/SYNC_LIB/SYNC_ASSETS 지정 시 실제 DeviceSync 서버와 통합), `node dev/sync-ui-test.mjs`.
