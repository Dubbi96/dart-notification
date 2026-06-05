# Prisma / DB — 마이그레이션 규율 (★ 에이전트 필독)

> 상위: `backend/CLAUDE.md` · 전역 회귀 매트릭스: `docs/roadmap/01-execution-roadmap.md §3`
> DB는 되돌리기 가장 어려운 자원이다. 아래 절차를 어기면 데이터가 파괴된다.

## 절대 금지 (`.claude/hooks/guard-bash.mjs`가 차단)

- `prisma migrate reset` — **금지(차단됨)**. DB 전체 초기화. 필요 시 사람이 수동 실행.
- `prisma migrate deploy` — 운영 반영. **휴먼 승인(ask)** 후에만.
- `prisma db push --force-reset` — 금지.
- `WHERE` 없는 `DELETE`, `DROP/TRUNCATE TABLE` — 금지.

## 스키마 변경 표준 절차

1. `prisma/schema.prisma` 수정 (모델 추가/변경).
2. **자연키 우선**: 신규 모델은 `rcpNo`(→`Disclosure`) 또는 `corpCode`(→`Company`)를 FK 루트로 연결. 인덱스(`@@index`)·복합 유니크(`@@unique`) 명시.
3. `npm run prisma:migrate:dev` → `--name <영문-설명>` (예: `add_disclosure_event`). ← **휴먼 승인(ask) 후 실행**.
4. 생성된 `prisma/migrations/<timestamp>_<name>/` 디렉터리를 **반드시 커밋**.
5. `npm run prisma:generate`로 클라이언트 재생성(allow, 자동).
6. 변경 내용을 `docs/database-schema.md`에 반영.

## 규칙

- **이미 커밋된 마이그레이션 파일은 절대 수정·삭제하지 않는다.** 새 마이그레이션으로 보정.
- 마이그레이션은 재현 가능해야 한다(CI에서 `migrate deploy`로 적용 가능).
- 시드 변경: `prisma/seed.ts` / `prisma/seed-notifications.ts` (`npm run prisma:seed`).
- 엔진별 모델 소유권은 `docs/roadmap/cc-engine-architecture.md §4-5` 표를 따른다.
- 마일스톤 종료 시 FK 정합·고아 레코드 0·마이그레이션 재현성 점검(전역 회귀 매트릭스).
