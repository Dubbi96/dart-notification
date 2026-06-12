# DAR-161 — 알림 인박스 타입 필터 + 타입별 unread (feat)

> 등록: 2026-06-12 (편의성·시인성 고도화 패널 v6, 멀티에이전트 감사) · layer: both · severity: medium · effort: small
> 담당: Paperclip 플릿(be+fe). branch: `feat/DAR-161-notification-type-filter`

## 배경/문제
NotificationHistory.type(DISCLOSURE/SIGNAL/EXIT/THESIS, DAR-84 완료)이 적재되지만 조회 DTO·where에 type 필터가 없다. 알림 탭은 모든 타입을 한 줄로 섞어 보여줘 신호/청산 알림이 공시 알림에 묻힌다. 타입별 unread 카운트도 없다.

## 근거 (코드)
- `backend/src/notifications/dto/query-notification.dto.ts` — page/limit/isRead만, `type` 없음.
- `backend/src/notifications/notifications.service.ts:71` — where절에 type 미반영.

## 해결 방향 (구현 자유)
- 백엔드: `QueryNotificationDto`에 optional `type`(enum: DISCLOSURE|SIGNAL|EXIT|THESIS) 추가, 서비스 where 반영. unread 응답에 타입별 unreadCount 맵 추가(예: `{ DISCLOSURE: n, SIGNAL: m, ... }`). 상대경로 import.
- 모바일: 알림 탭 상단에 공시/신호/청산 세그먼트 칩. React Query 훅 queryKey에 type 포함. 각 세그먼트에 타입별 unread 점 배지.

## 영향 파일
- `backend/src/notifications/dto/query-notification.dto.ts`, `notifications.service.ts`, `notifications.controller.ts`
- `mobile/app/(tabs)/notifications`(또는 알림 화면), `mobile/hooks/`, `mobile/services/`
- `docs/api-specification.md`

## 수용 기준 (DoD)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 통과 · `npm test` 그린
- [ ] type 필터로 알림 목록 분류 조회, 타입별 unreadCount 반환
- [ ] 알림 탭 세그먼트로 타입 전환 + 타입별 unread 배지 동작
- [ ] 스키마 변경 없음
- [ ] AI 금지영역 미침범 · 문서 동기화(`docs/api-specification.md`)
