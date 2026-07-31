# npm audit 트리아지 — 2026-07-16 실측 (W17 보안 태세)

> 실측 명령: `npm audit --omit=dev --json` (backend·mobile 각각, 2026-07-16)
> 게이트: `scripts/audit-gate.mjs` — allowlist(`.audit-allowlist.json`) 밖의 **high/critical** advisory만 CI 실패.
> 원칙: `npm audit fix` / `--force` **금지**(Expo/RN peer-deps 파손 위험, `--legacy-peer-deps` 운용). 해소는 별도 의존성 업그레이드 PR로.
>
> **2026-07-31 갱신**: bcrypt 6 전환으로 `@mapbox/node-pre-gyp → tar` 체인을 제거했다. 신규 advisory와 나머지 해소 내역은 `audit-remediation-2026-07-31.md`를 참조한다.

## 실측 요약

| 워크스페이스 | critical | high | moderate | low | 게이트 대상(고유 advisory) |
|---|---|---|---|---|---|
| backend | 0 | 10 (패키지 기준) | 15 | 0 | high 24건 |
| mobile | 1 | 4 (패키지 기준) | 13 | 1 | critical 1 + high 13건 |

- "패키지 기준" 수치는 npm audit 메타데이터(전이 체인 포함), "고유 advisory"는 게이트가 실제 대조하는 중복 제거 advisory 수.
- `@mapbox/node-pre-gyp`(backend)·`@nestjs/platform-express`(backend)는 자체 advisory 없이 각각 tar·multer 체인으로 high 판정 — 루트 advisory 수용으로 함께 통과.

## 트리아지 표 (high/critical 전건)

| # | WS | 패키지 | 심각도 | advisory ID (GHSA) | 요지 | 경로 | 수정 경로 | 판정·사유 | 해제 조건 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | BE+MO | axios | high ×10 | 1117576(GHSA-pmwg-cvhr-8vh7) · 1117591(GHSA-pf86-5x62-jrwf) · 1117593(GHSA-6chq-wfr3-2hj9) · 1118607(GHSA-q8qp-cvcw-x6jj) · 1120547(GHSA-hfxv-24rg-xrqf) · 1120643(GHSA-777c-7fjr-54vf) · 1120645(GHSA-p92q-9vqr-4j8v) · 1120647(GHSA-j5f8-grm9-p9fc) · 1120649(GHSA-3g43-6gmg-66jw) · 1120650(GHSA-35jp-ww65-95wh) | 프로토타입 오염 가젯·프록시 자격증명 누출·ReDoS 등 | 직접 의존(backend ^1.6.0 / mobile ^1.13.6) | **1.16.0 — semver 범위 내(non-breaking)** | 수용(단기) — 프록시 미사용, 호출 대상이 자사 API·DART/KRX/KIS 로 한정. **우선순위 1 업그레이드 대상** | axios ≥1.16.0 업그레이드 PR 머지 |
| 2 | BE+MO | form-data | high | 1120743(GHSA-hmw2-7cc7-3qxx) | multipart 필드명 CRLF 주입 | axios 전이(4.0.0–4.0.5) | 4.0.6 (axios 업그레이드에 동반) | 수용 — multipart 업로드 미사용 | #1과 동시 해소 |
| 3 | BE | tar | high ×6 | 1112659(GHSA-34x7-hfp2-rc4v) · 1113300(GHSA-8qq5-rm4j-mr97) · 1113375(GHSA-83g3-92jg-28cx) · 1114200(GHSA-qffp-2rhf-9h96) · 1114302(GHSA-9ppj-qmqm-q256) · 1114680(GHSA-r6q2-hw4h-h46w) | 압축 해제 경로 탐색·심링크 | bcrypt → @mapbox/node-pre-gyp → tar (빌드타임) | bcrypt 6 전환으로 체인 제거 | **해소(2026-07-31, #553)** — allowlist 항목 제거 | 완료 |
| 4 | BE | multer | high ×4 | 1113635(GHSA-xf7r-hgr6-v32p) · 1113636(GHSA-v52c-386h-88mc) · 1113996(GHSA-5528-5vmv-3xc2) · 1121089(GHSA-72gw-mp4g-v24j) | 업로드 DoS 계열 | @nestjs/platform-express(^10) 전이 | **NestJS v11 메이저** (semver-major) | 수용 — 파일 업로드 엔드포인트 부재로 노출면 없음. 프레임워크 일괄 업그레이드는 M10 모의운용 무중단 원칙과 충돌 → M10 졸업 후 | NestJS v11 업그레이드 |
| 5 | BE | lodash | high | 1115806(GHSA-r5fr-rjxr-66jc) | `_.template` 코드 주입 | @nestjs/config·@nestjs/swagger(^7) 전이 | @nestjs/swagger v11 (semver-major) | 수용 — 외부 입력이 템플릿에 닿는 경로 없음 | NestJS v11 업그레이드 |
| 6 | BE | path-to-regexp | high | 1115527(GHSA-37ch-88jc-xwx2) | 다중 라우트 파라미터 ReDoS | express 4.x 전이 | express 패치(전이 갱신) | 수용 — 라우트 패턴 코드 고정, 해당 패턴 미사용 | express/전이 갱신 PR |
| 7 | BE | fast-xml-parser | high | 1115339(GHSA-8gc5-j5rx-235r) | 숫자 엔티티 폭발 한도 우회 | 직접 의존(^5.4.2, DART/KRX XML 파싱) | 5.5.6+ (semver 범위 내) | 수용(단기) — 입력이 공공 API 응답으로 한정. **우선순위 1 업그레이드 대상** | fxp ≥5.5.7 업그레이드 PR |
| 8 | BE | fast-xml-builder | high | 1118965(GHSA-5wm8-gmm8-39j9) | 속성값 따옴표 우회 | 전이(≤1.1.6) | 최신판 | 수용 — XML 생성(빌드) 미사용, 파싱만 사용 | 전이 갱신 PR |
| 9 | MO | picomatch | high | 1115552(GHSA-c2c7-rcm5-vvqj) | extglob ReDoS | Expo/Metro 전이(≤2.3.1) | 2.3.2 (전이) | 수용 — 번들타임 도구, 앱 런타임 번들 미포함 | Expo SDK 업그레이드 |
| 10 | MO | shell-quote | **critical** | 1120422(GHSA-w7jw-789q-3m8p) | `quote()` 개행 미이스케이프 | RN CLI/Metro 전이(1.1.0–1.8.3) | 1.10.0 override | **해소(2026-07-31, #553)** — allowlist 항목 제거, 신규 1123944도 동시 해소 | 완료 |
| 11 | MO | ws | high | 1123260(GHSA-96hv-2xvq-fx4p) | 단편 프레임 메모리 고갈 DoS | Metro 개발 서버(HMR) 전이(7.0.0–7.5.10) | 7.5.11 (전이) | 수용 — 로컬 개발 서버 전용, 앱 런타임 미포함 | Expo SDK 업그레이드 |

## 판정 원칙

1. **직접 의존 + non-breaking 수정판 존재**(#1 axios, #7 fast-xml-parser): 임시 수용 — 다음 의존성 업그레이드 PR(회귀 CI 하드 게이트 동반)에서 최우선 해소. 이번 레인은 `npm install` 금지 규약이라 코드로 못 고침.
2. **NestJS v11 메이저 필요**(#4 multer, #5 lodash, @nestjs/platform-express 체인): M10 모의운용 무중단(≈8/5 졸업 측정) 중 프레임워크 일괄 교체 금지 → M10 졸업 후 계획 업그레이드.
3. **Expo/RN 전이 + 개발·번들타임 전용**(#9~#11): 앱 런타임 번들에 미포함 — Expo SDK 업그레이드 사이클 대기. `--omit=dev`에도 잡히는 것은 RN 프로젝트가 도구 체인을 dependencies로 두는 구조 탓.
4. **빌드타임 체인**(#3 tar): 런타임 요청 경로에서 임의 아카이브를 다루지 않음.
5. moderate/low(backend 15·mobile 14)는 게이트 비대상 — dependabot 주간 PR로 자연 해소 추적.

## 운영 절차

- **새 high/critical 유입 시**: CI `security-audit` 잡이 실패 → (권장) 업그레이드로 해소, 불가하면 `.audit-allowlist.json`에 advisory ID+사유 추가 후 이 문서에 행 추가.
- **해소 시**: allowlist 항목 제거(게이트가 stale 항목을 경고로 표시) + 이 문서의 해당 행에 해소일 기입.
- **재실측**: dependabot 머지 후 또는 월 1회 `node scripts/audit-gate.mjs backend && node scripts/audit-gate.mjs mobile` 로컬 실행.

---
*작성: 2026-07-16 · W17 보안 태세(갭분석) — CI 보안 잡·dependabot·Swagger prod 게이트와 함께 도입*
