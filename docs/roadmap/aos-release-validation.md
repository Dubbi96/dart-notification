# AOS A1–A8 Release Validation

Issue #578과 PR #579의 Android 내부 검수 릴리스 기록이다.

## Artifact

| 항목 | 값 |
|---|---|
| EAS project | `@duvbi/dart-alert` |
| Build profile / channel | `preview` / `preview` |
| EAS build ID | `bd94d3f2-7f24-49b5-be78-b8b7e389bbc3` |
| Source commit | `aa7e86caf921b7f0d88fb0bd79e2cb9ad15e1c31` |
| App / runtime version | `1.0.3` / `1.0.3` |
| Android versionCode | `5` |
| EAS fingerprint | `633f0699b6cd8358b8a3e6fa3171ce8348cc68a6` |
| Completed | `2026-08-01T01:42:05.173Z` |
| EAS install page | `https://expo.dev/accounts/duvbi/projects/dart-alert/builds/bd94d3f2-7f24-49b5-be78-b8b7e389bbc3` |
| EAS artifact | `https://expo.dev/artifacts/eas/NFrfxTTPZ1ZaaAsqxaz7V4vV4Di8U3AdAIbm2zLZqNE.apk` (2026-08-15 만료 예정) |
| Local artifact | `/Users/gangjong-won/Downloads/Gongsion-AOS-1.0.3-build5.apk` |
| Size | `117,501,512 bytes` |
| SHA-256 | `7ee155747004e4965befcca774937d474482b902955a1abea61cd800b47b0029` |

GitHub Release `aos-v1.0.3-build5`에도 같은 APK를 첨부해 EAS 임시 URL 만료와 무관하게 보존한다.

## Verification

- PR #577 (A8): Backend, Mobile, Operator Web, npm audit allowlist, gitleaks CI 5/5 통과
- PR #579 (release): 동일 CI 5/5 통과
- Backend: 367 suites / 4,772 tests, Nest production build 통과
- Shared Rule Engine: 17 tests와 TypeScript build 통과
- Mobile: 32 suites / 205 tests, typecheck, lint 0 errors, Android export 통과
- Operator Web: typecheck, 2 tests, production build 통과
- Admin demo: 1280px와 375×812에서 horizontal overflow 0 확인
- Prisma: schema valid, 새 로컬 DB에 전체 78 migrations 적용
- DB 제약: 101원 배분 50/30/21, 손실·0원 거부, plan immutable, ledger append-only 확인
- 다운로드 APK: ZIP 무결성 검사와 SHA-256 계산 통과

## Deployment boundary

이 릴리스는 설치 가능한 내부 검수 APK와 Admin production build를 완성한다. 사용자 승인에 따라
2026-08-01 운영 DB에 AOS migration 10개를 적용했고, 적용 전 S3 전체 백업과 적용 후 Prisma/HTTP health를
확인했다. 후속 승인으로 같은 날 OCI Backend 이미지와 Admin HTTPS 정적 호스팅도 배포했다.

- Backend: AOS 공용 Rule Engine 포함 amd64 production image, container healthy
- Admin: `https://admin.168.138.198.152.nip.io`, same-origin `/api`, CSP/HSTS, source map 0
- 운영자: 승인 이메일 bootstrap 등록, Mutation 전역 OFF

다음 작업은 포함하지 않았다.

- 실도메인, SSO/2FA, bootstrap env의 DB membership 전환
- Operator mutation 활성화와 역할별 복수 계정 분리
- 송금, 환전, 실브로커 주문 또는 A9 LIVE adapter

따라서 A1–A8의 DB·Backend·Admin 조회 경로는 운영에 반영됐지만, 변경 명령과 LIVE 거래 경로는 계속
차단되어 있다.
