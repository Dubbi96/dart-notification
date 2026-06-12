# DAR-168 — 모바일 lint 기존부채 청소 (chore)

> 등록: 2026-06-12 (패널 v6 머지 후 검증에서 발견) · layer: mobile · severity: low · effort: small
> 담당: Paperclip 플릿(fe). branch: `feat/DAR-168-mobile-lint-debt`
> (paperclip 식별자 DAR-168. DAR-167은 DEVELOPER 자동발행 tsc-red 이슈 — 별건, 현재 main에서 해소됨)

## 배경
패널 v6(DAR-143~166) 머지 후 main 직접 검증에서 `mobile npm run lint`가 **15 errors(+318 warnings)로 exit 1**. 코드검증 결과 **전부 이번 배치와 무관한 기존 부채**(베이스라인 4e066e9에도 존재, 에러 파일 6개 중 5개는 배치 미수정). CI가 없어 그동안 게이트되지 않고 누적됨. lint를 그린으로 만들어 향후 DoD 게이트를 복구한다.

## 근거 (코드) — 룰별 15 errors
- `@typescript-eslint/no-explicit-any` (다수): `app/legal/privacy.tsx:127`, `app/legal/terms.tsx:103`, `app/settings-detail/saved-disclosures.tsx:37`, `components/common/DialogProvider.tsx:80`, `hooks/useAuth.ts:34` 등
- `@typescript-eslint/no-require-imports`: `app/auth/sign-in.tsx:227` (`require()` 스타일 import)
- `react-native/no-single-element-style-arrays`: `app/auth/sign-in.tsx:193` (단일 원소 style 배열 → 불필요 리렌더)
- 위는 대표 목록. **정본은 `cd mobile && npm run lint` 출력 전체**(롱라인 누락분 포함 총 15 errors).

## 해결 방향 (구현 자유)
- `any` → 명시적 타입/제네릭으로 교체(불가피한 외부 타입만 `unknown`+가드). `eslint-disable` 남발 금지.
- `require()` → ESM `import`로 전환(자산은 `import x from '...'`).
- 단일 원소 style 배열 → 객체 직접 전달.
- **동작 변경 0**(순수 타입·import 정리). warnings(import/order 등 318건)는 `--fix` 가능분만 선택 정리(필수 아님).

## 영향 파일
- `mobile/app/auth/sign-in.tsx`, `mobile/app/legal/privacy.tsx`, `mobile/app/legal/terms.tsx`, `mobile/app/settings-detail/saved-disclosures.tsx`, `mobile/components/common/DialogProvider.tsx`, `mobile/hooks/useAuth.ts` (+ lint 출력의 잔여 에러 파일)

## 수용 기준 (DoD)
- [ ] `cd mobile && npm run lint` **exit 0 (errors 0)**
- [ ] `npx tsc --noEmit` 에러 0 · 동작 회귀 없음
- [ ] `eslint-disable` 신규 추가 0(또는 불가피 사유 주석 명시)
