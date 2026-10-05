# 기기 동기화 (같은 Wi-Fi, 사용자 실행형)

- 휴대폰(Android) 앱: 도구 → ‘다른 기기와 동기화’ → 주소·코드가 표시됨 (창을 닫으면 서버 종료).
- PC 앱: 도구 → ‘다른 기기와 동기화’ → 주소·코드 입력 → 합치기 / 이 PC→휴대폰 / 휴대폰→이 PC.
- 문서는 PDF 파일의 SHA-256으로 맞춥니다(양쪽에서 같은 PDF가 열려 있어야 함). 노트(sidecar JSON)와 참조된 이미지·녹음·동영상 파일을 주고받습니다.
- 합치기는 양쪽 항목의 합집합이며 삭제는 전달되지 않습니다. 평문 HTTP + 6자리 코드(10회 오류 시 잠김), 사설 IPv4 주소만 허용.
- 구조: `web/js/sync.js`(로직) · `host/Bridge.cs net.http`(https 페이지는 http를 직접 못 부르므로 호스트가 대신 요청) · Android `DeviceSync.java`.
- 테스트: `node dev/sync-test.mjs` (SYNC_PORT/SYNC_CODE/SYNC_DIR 지정 시 실제 DeviceSync 서버와 통합), `node dev/sync-ui-test.mjs`.
