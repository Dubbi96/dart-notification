# npm audit 차단 advisory 해소 — 2026-07-31

> Issue #553 · AOS Phase A2-1 PR의 regression-ci에서 새로 발견된 backend 차단 항목을 별도 보안 작업으로 해소한다.

## 1. 발견 상태

`node scripts/audit-gate.mjs backend` 기준:

| 워크스페이스 | 구분 | critical | high | moderate | 허용 advisory | 차단 advisory |
|---|---|---:|---:|---:|---:|---:|
| backend | 변경 전 | 1 | 12 | 13 | 25 | 6 |
| backend | 변경 후 | 0 | 8 | 13 | 19 | 0 |
| mobile | 변경 전 | 1 | 7 | 12 | 14 | 5 |
| mobile | 변경 후 | 0 | 4 | 12 | 13 | 0 |

backend 변경 전 차단 항목은 `adm-zip` 1건, `brace-expansion` 2건, `js-yaml` 1건, `tar` 2건이었다. 기존 allowlist에 있던 과거 `tar` 6건도 의존 체인 제거와 함께 해소했다.

CI는 backend 다음에 mobile audit도 실행한다. mobile에서 추가로 차단된 항목은 `brace-expansion` 2건, `js-yaml` 1건, `postcss` 1건, `shell-quote` 1건이었다.

## 2. 해소 방법

| 패키지/경로 | 변경 | 해소 근거 |
|---|---|---|
| `adm-zip` | `^0.5.16 → ^0.6.0` | GHSA-XCPC-8H2W-3J85 수정 버전 |
| `bcrypt` | `^5.1.0 → ^6.0.0` | `@mapbox/node-pre-gyp → tar@6` 설치 체인을 제거하고 `node-gyp-build` 기반으로 전환 |
| `@types/bcrypt` | `^5.0.0 → ^6.0.0` | bcrypt 런타임 메이저와 타입 계약 정렬 |
| `brace-expansion` | minimatch 3에는 `1.1.16`, minimatch 9에는 `2.1.4` override | 각 부모가 선언한 메이저 범위를 유지하는 보안 수정판 |
| `js-yaml` | override `4.3.0` | NestJS Swagger 7의 4.x API 계약을 유지하면서 merge-key DoS 수정판 사용 |

`npm audit fix --force`와 NestJS/Expo 메이저 업그레이드는 실행하지 않았다.

모바일은 Expo/RN 직접 버전을 바꾸지 않고 다음 전이 버전만 각 부모의 semver 범위 안에서 고정한다.

| 패키지/경로 | 변경 | 영향 |
|---|---|---|
| `brace-expansion` | minimatch 3/8/10별 `1.1.16` / `2.1.4` / `5.0.9` | Expo CLI·lint·test glob 처리 |
| `@expo/xcpretty → js-yaml` | `4.3.0` | Expo CLI 출력 포매터 |
| `@expo/metro-config → postcss` | `8.5.25` | Metro CSS 처리 |
| `react-devtools-core → shell-quote` | `1.10.0` | 개발 도구 명령 파싱 |

## 3. 영향 분석

- `adm-zip`은 DART `document.xml` 응답을 메모리에서 읽는 경로에서만 사용한다. 기존 생성자, `getEntries()`, `getData()` API 계약은 유지된다.
- `bcrypt`는 가입 시 `hash()`와 로그인 시 `compare()`만 사용한다. 저장된 bcrypt 해시 형식과 cost 10 정책은 변경하지 않는다.
- `brace-expansion`은 개발/빌드 도구의 minimatch 하위 경로다.
- `js-yaml`은 Swagger 문서 생성과 빌드 설정 하위 경로다. 서비스가 외부 YAML을 입력으로 받는 엔드포인트는 없다.
- 모바일 앱 소스·에셋과 직접 의존성, Expo SDK, RN, 네이티브 모듈, app version은 변경하지 않는다. `package.json`의 override와 lockfile은 빌드/개발 도구 전이 패키지만 교체한다.

## 4. 잔여 항목

게이트에 남은 high advisory는 기존 문서화된 allowlist 범위다. axios/fast-xml-parser는 별도 직접 의존성 갱신, multer/lodash/path-to-regexp는 NestJS 업그레이드 사이클에서 처리한다. allowlist에 신규 항목은 추가하지 않았다.

## 5. 검증

- backend audit allowlist gate
- backend clean `npm ci`
- mobile clean `npm ci --legacy-peer-deps`
- Nest build 및 TypeScript noEmit
- 인증 bcrypt hash/compare 테스트
- DART ZIP 추출 호환 테스트
- 전체 Jest 회귀
- mobile typecheck, lint, Jest, Android export
