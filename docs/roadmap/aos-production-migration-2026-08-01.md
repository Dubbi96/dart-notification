# AOS Production Prisma Migration — 2026-08-01

Issue #580의 운영 변경 기록이다. 사용자가 대화에서 `prisma migrate deploy`를 명시적으로 승인한 뒤
OCI production DB에 적용했다. 애플리케이션 이미지와 Admin은 배포하지 않았다.

## Preflight

- 대상: micro2 PostgreSQL `dart_notification`, `public` schema
- 실행 경로: micro1의 기존 `dart-notification-backend:prod` 이미지가 가진 Prisma 5.22.0
- migration source: `origin/main` merge `3c975da0cf01a17e17a0a92875e367e5cd246d8c`
- 적용 전 상태: 전체 78개 중 기존 68개 적용, AOS 10개 pending
- 백업: S3 `backups/dart_notification_2026-08-01.dump.gz`
- 압축 백업 크기: 257,360,955 bytes

## Applied migrations

1. `20260731010000_aos_strategy_versioning_foundation`
2. `20260731020000_aos_strategy_activation`
3. `20260731030000_aos_risk_policy_versioning`
4. `20260731040000_aos_approval_config_audit`
5. `20260731050000_aos_feature_snapshot`
6. `20260801010000_aos_decision_ledger`
7. `20260801020000_aos_versioned_backtest`
8. `20260801030000_aos_canonical_paper_shadow`
9. `20260801040000_aos_operator_console_rbac`
10. `20260801050000_aos_allocation_planning`

`prisma migrate deploy`는 10개를 순서대로 적용하고 `All migrations have been successfully applied`로
종료했다. 후속 `prisma migrate status`는 78개를 찾고 `Database schema is up to date`를 반환했다.

## Post-check

- Backend container: `running healthy`
- 내부 `/health`: database/redis/external keys 모두 `up`
- 공개 HTTPS `/health`: 동일하게 `status=ok`
- 앱 컨테이너 재시작 없음
- 임시 host/container migration 파일 삭제 완료

## Human intervention and boundary

- 무엇을: 사용자 승인에 따라 production DB schema에 AOS migration 10개 적용
- 왜: main과 AOS APK/Admin 코드가 요구하는 additive schema를 준비하기 위해
- 미실행: Backend 이미지 배포, Admin hosting, 실거래·송금·환전·브로커 연결

진행 확인 중 DB 접속 문자열이 비공개 작업 도구 로그에 노출됐다. 값은 저장소, Issue, PR, 응답에
기록하지 않는다. 자격증명 교체는 DB role 변경, 운영 환경변수 갱신과 앱 재시작을 수반하므로 별도
승인 작업인 Issue #581로 추적한다.
