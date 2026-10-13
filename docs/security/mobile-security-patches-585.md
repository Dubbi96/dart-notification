# Mobile 보안 패치 검증 후보 — #585

검토일: 2026-10-13 KST. 기존 작업 브랜치 `feat/585-aos-mobile-agent`, Draft PR #586의 후속이다.

## 승인 범위와 릴리스 상태

후속 승인(2026-10-13): 사용자가 **정식 출시는 보류하고, 자체 패치를 적용한 내부 검토용 APK만 빌드하며 보안 차단은 유지**하도록 승인했다. 이에 `1.0.5 (7)` / runtime `1.0.5` / 기존 `preview` 프로필의 APK 빌드·파일 검증을 완료했다. OTA·운영 배포·스토어 제출·병합·휴대전화 설치는 이번 승인에 포함하지 않는다. 아래의 빌드 보류·버전 유지 서술은 선행 검증 시점의 기록이다.

사용자는 보안 차단 4건 해소와 다음 APK를 요청했다. 공식 수정판이 없는 2건 및 공개 패치의 추가 검토 필요성을 알린 뒤, **“자체 패치 검증까지 진행하되 릴리스 여부는 결과 보고 후 결정”**을 선택했다. 따라서 이번 변경은 검증 후보이며 APK 발주·OTA·휴대전화 설치·운영 배포·병합 승인이 아니다. 앱 버전도 기존 `1.0.4 (6)` 그대로 둔다.

`.audit-allowlist.json`과 `scripts/audit-gate.mjs`는 변경하지 않는다. 미공개 백포트를 적용해도 npm은 원래 패키지 버전으로 취약점을 보고한다. 테스트 통과, 공식 advisory 해소, 릴리스 승인을 각각 구분한다.

### 승인된 내부 APK 빌드

- 빌드: `90b7bf48-e1f6-4772-ad66-7e60193cd3ab`, 소스 `e6c09cc20c46a6e0b2457c81762a01fc46e4c22b`, `preview / INTERNAL / Android APK`, `1.0.5 (7)` / runtime `1.0.5`.
- 정식 출시·스토어 제출·OTA·병합·휴대전화 설치는 수행하지 않는다. preview는 기존 운영 API를 사용하므로 별도 백엔드 sandbox를 뜻하지 않는다.
- 업로드 아카이브의 패치 3개·보안 검사 2개·패키지/설정 파일이 소스와 일치하고 공통 Rule 파일 10개가 포함됨을 확인했다. 비밀키/keystore/service-account 파일명은 없었고 환경 파일은 example 5개만 포함됐다. 향후 다른 파일까지 자동으로 제외된다는 보장은 아니다.
- 버전 변경 후 Mobile 332 tests, 앱·테스트 타입 검사, 보안 회귀 9테스트+239그룹 재통과. 빌드 커밋 [CI 실행 38352904559](https://github.com/Dubbi96/dart-notification/actions/runs/38352904559)는 Mobile·Backend·Operator·gitleaks 통과, 보안 감사는 2건 차단으로 실패했다.
- EAS `INSTALL_DEPENDENCIES`와 `PREBUILD` 양쪽에서 패치 재적용·보안 회귀 통과를 확인했다. 기존 원격 keystore를 사용하고 `--freeze-credentials`로 자격 증명 변경을 막았다.
- EAS **FINISHED**, 2026-10-13 **15:04:23 KST**. Gradle `BUILD SUCCESSFUL in 18m 31s`. [인증된 빌드 페이지](https://expo.dev/accounts/duvbi/projects/dart-alert/builds/90b7bf48-e1f6-4772-ad66-7e60193cd3ab). 내부 APK의 직접 다운로드 URL은 공개 PR에 추가하지 않았다.

| 다운로드한 APK 검사 | 결과 |
| --- | --- |
| 파일 | `Gongsion-AOS-1.0.5-build7-internal-review-90b7bf48.apk` |
| 크기 | 117,546,600 bytes (이전 APK 대비 +12,948 bytes) |
| SHA-256 | `c6c7bc7651070f78d36aa88f0fe8e6342f18aea3affb15bd555307b6306a0642` |
| ZIP 무결성 | `unzip -tqq` 통과 |
| 실제 서명 검증 | 공식 Google Maven `apksig 9.4.1`의 `ApkVerifier`: verified / v2 true, 오류·경고 0 |
| 서명 인증서 SHA-256 | `8bcff5910bfb010b294607c7140b673feb1c142904237caf691c3ff48d776cd7`; 기존 `1.0.4 (6)`과 동일 |
| APK manifest / embedded config | `com.gongsion.app`, `1.0.5 (7)`, runtime `1.0.5`, channel `preview`, debuggable false |
| 기존 APK와 비교 | 권한 31개 및 maxSdk 제한·선언 권한, minSdk 24 / targetSdk 36, update URL·시작 정책, backup/cleartext 설정 동일 |
| 번들 API 설정 | 내장 Hermes 번들에 기존 승인 API URL 포함 확인; 실제 API 호출·새 APK 실행 검증은 아님 |

정적 메타데이터 비교에서 파일 경로·크기·해시·앱 버전·versionCode·runtime 외 변경은 없었다. 기존 동일 서명 확인은 업데이트 호환성을 위한 정적 증거이며, 새 APK의 설치 성공이나 로그인 보존을 실제 확인한 것은 아니다. 보안 차단 **2건**과 Draft PR을 유지한다. OTA·휴대전화 설치·운영 서버·DB·실주문·스토어 제출은 수행하지 않았다.

### Expo 진단에서 남은 별도 호환성 위험

이번 빌드와 이전 `1.0.4 (6)` 빌드 로그 모두 `expo doctor` **18/22 통과, 4개 실패**였다. 이 4개는 npm high advisory 2건과 다른 검사다. 네이티브 빌드가 성공하더라도 아래 진단이 해소된 것은 아니다.

1. 기존 `app.json`의 `splash` 필드 schema 경고.
2. `@expo/vector-icons`가 요구하는 `expo-font` 직접 peer 의존성 누락 경고. 현재 APK에서 폰트가 정상인지 새 실기기 검사로 확인해야 한다.
3. Expo 56 / RN 0.85의 Hermes V1 메모리 회귀 경고. 이 앱은 worklets/reanimated를 사용한다. 공식 문서는 SDK 57의 수정 버전으로 전환하도록 안내한다. 이는 앱의 무거움과 관련될 수 있는 가설이지 이번 APK의 메모리 사용 실측 결과는 아니다. [공식 Known regressions](https://expo.dev/changelog/sdk-57#known-regressions).
4. Expo·관련 패키지 12개가 SDK 권장 버전과 불일치. 예외 설정으로 경고를 숨기지 않았다.

이번 승인 범위는 검증한 패치의 내부 APK 빌드다. SDK/RN 전환과 의존성 정렬은 별도 회귀 범위로 남긴다. 장시간 메모리·배터리·앱 종료/복구·폰트 실기기 검증 없이 정식 출시로 승격하지 않는다.

## 대상과 접근

| 대상 | 변경 | 판정 기준 |
| --- | --- | --- |
| image-size ICNS / GHSA-w3rx-r6r6-pgpr | 공식 `2.0.4` 고정 + Metro 파일 경로를 버퍼 입력으로 전환 | 공식 수정판, 실제 이미지 호환, malformed ICNS 즉시 거부 |
| image-size JXL·HEIF / GHSA-5p2g-fcmc-qvqq | 같은 수정판 | malformed JXL·HEIF 즉시 거부 |
| braces / GHSA-vfj7-8cjw-p6xm | `3.0.3`에 검증용 백포트 | 깊은 패턴·AST 및 순환 참조 거부, 정상 glob 보존; 공식 수정판 아님 |
| node-forge / GHSA-86w9-cpqp-85rv | `1.4.0`에 검증용 백포트 | 정상 서명 및 optional NULL 호환, 비정규 DigestInfo 거부; 공식 수정판 아님 |

Expo/RN 메이저 변경, 패키지 이름·버전을 바꿔 감사 결과 숨기기, 예외 추가는 하지 않는다. 세 패치 재적용은 표준 `patch-package 8.0.1`을 사용한다. 새 개발 전이 의존성 13개가 추가되며 `patch-package → find-yarn-workspace-root → micromatch → braces`도 같은 검증 대상이다. 앱 런타임에 새 라이브러리를 import하지 않는다.

## 재현과 검증

`mobile`에서 실행한다.

```sh
npm ci --legacy-peer-deps
npm run test:dependency-security
npm run typecheck
npx tsc -p tsconfig.test.json --noEmit
npm test -- --runInBand --silent --forceExit
npm run lint
npm run bundle:android
```

`npm ci`는 `postinstall`에서 패치를 적용하고 보안 회귀를 필수 실행한다. `--ignore-scripts`나 개발 의존성을 제외한 설치는 이 검증 경로가 아니다. 보안 회귀는 정확한 버전, 패치 존재·해시, 실제 적용 코드 및 악성 입력 동작을 검사한다. CI에도 보안 회귀·테스트 타입 검사·전체 Mobile Jest를 추가한다. 보안 감사 잡은 별도로 계속 차단 여부를 판정한다.

### 백포트 출처와 추가 수정

- braces: Corvette052의 [PR #88 / a795ee83ecd011131b2d618fe754ac5a8e124dae](https://github.com/micromatch/braces/pull/88)를 기반으로 한다. 문자열 파싱 및 공급된 AST의 깊이를 128로 제한하고 nodes 순환을 검사한다. 별도 검토에서 공개 제안이 놓친 `expand`의 `parent` 순환·과도한 길이를 찾아 로컬 가드를 추가했다. 정상 AST의 부모 역참조는 허용한다. leaf까지 센 AST 깊이 제한이므로 128겹 패턴은 파싱되더라도 walker에서 거부될 수 있다.
- node-forge: matthewscottconroy의 [PR #1159 / db05494352dd3c9a5a07c5270333dcc78866cad2](https://github.com/digitalbazaar/forge/pull/1159)의 `lib/rsa.js`와 동일한 변경이다. AlgorithmIdentifier의 요소 개수만 세는 첫 제안은 NULL payload 우회가 남아 채택하지 않았다. 예상 DigestInfo를 정규 DER로 다시 인코딩해 비교한다. 정상 optional NULL 계약, PSS/NONE 경로를 보존한다.
- Forge의 비공개 테스트 옵션 `_parseAllDigestBytes=false`에 대한 기존 prefix 비교 호환은 유지된다. 이를 안전한 검증 옵션으로 권장하지 않는다. 설치된 Expo CLI/code-signing 호출에는 이 옵션이나 `_skipPaddingChecks` 사용이 없고 기본 strict 경로를 사용함을 코드 검색 및 실제 호출 테스트로 확인했다.

두 PR 모두 검토일 현재 미병합·미발행 제안이다. 원저자의 테스트 결과만 인용하지 않고 아래 로컬 검증을 다시 실행했다. 별도 검토 에이전트의 코드 검토는 외부 전문기관의 암호 감사를 뜻하지 않는다.

### 로컬 실측 결과

| 검사 | 결과와 범위 |
| --- | --- |
| clean `npm ci --legacy-peer-deps` | 통과, 17초. Metro·braces·node-forge 세 패치를 재적용하고 postinstall 보안 검사를 실행 |
| 이미지 보안 회귀 | 9/9: 버전/해시, 앱 이미지 11개, TTF, 빈 이미지, @2x 및 `.zip/` 이름 폴더, ICNS/JXL/HEIF 비정상 입력 거부 |
| 파서·서명 회귀 | braces 16그룹 + forge 220그룹 + 설치/해시/중복 인스턴스 3그룹 통과. Node 25.9.0 및 CI 계열 Node 20.20.2에서 실행 |
| braces 상위 전체 테스트 | PR #88 테스트를 로컬 패치 라이브러리로 연결해 899/899 통과 |
| forge 상위 전체 테스트 | PR #1159의 로컬 패치와 동일한 lib에서 833 통과 / 기존 pending 4 / 실패 0 |
| Mobile 전체 Jest | 45 suites / 332 tests / 5 snapshots 통과. 기존 open handle 때문에 `--forceExit` 사용 |
| Mobile 앱/테스트 TypeScript | 둘 다 통과 |
| Mobile lint | 오류 0, 기존 경고 816. 새 CJS 검사 파일도 별도 lint |
| Android export | 6,182 modules, 약 13 MB Hermes 번들 생성 통과; 네이티브 APK 빌드가 아님 |
| audit gate self-test | 6개 통과, 판정 로직 수정 없음 |
| Backend / Operator 감사 | 각각 기존 예외 4건으로 통과 / advisory 0건으로 통과 |

braces 검사는 512 KiB stack의 별도 프로세스에서 깊은 문자열·AST·nodes/parent 순환을 검사한다. Forge 검사는 일회용 RSA 2048-bit, e=3/65537, 기존 허용 OID 9개, 비정상 DER 11형태, OpenSSL 기반 Node crypto와의 상호 확인, Expo 인증서·manifest 서명·CSR 경로를 포함한다. MD2는 기존 OID 계약을 검사하는 합성 digest이며 보안 알고리즘으로 권장하거나 Node 지원을 주장하지 않는다. 개인키 없이 유효 서명을 위조하는 공격 전체를 재현한 것은 아니다.

`.zip/` 이름 폴더 검사는 실제 Yarn PnP ZipFS 검증이 아니다. 현재 프로젝트는 npm을 사용한다. 무한 루프 회귀는 제한시간이 있는 자식 프로세스에서 실행한다.

### 현재 감사 판정

Mobile `npm audit --omit=dev`: critical 0 / high 16 / moderate 10 / low 1. 고유 high advisory **2건, 예외 0, 차단 2 → 실패**. high 16은 전이 의존성 노드 수이며 16개 독립 취약점이라는 뜻이 아니다. 개발 의존성 포함 전체 보고서는 critical 0 / high 53 / moderate 12 / low 1, 총 66노드다. 패치 코드는 설치 시 검증되지만 버전 기반 npm advisory 판정은 바뀌지 않는다.

이미지 2건은 공식 수정판으로 advisory가 제거됐다. 나머지 2건은 반례를 통과한 검증 후보이며 **공식 차단 0건·정식 release 준비 완료가 아니다**. 신규 예외를 넣거나 버전을 속여 통과 처리하지 않았다.

구현 commit `3c6e3462b`의 [GitHub CI 실행 38348691578](https://github.com/Dubbi96/dart-notification/actions/runs/38348691578): Mobile(설치/패치 검사/앱·테스트 타입 검사/332테스트/lint/Android export), Backend, Operator, gitleaks 통과. 감사 잡은 Mobile 고유 high 2건으로 실패했으며 로그에서 정확한 advisory를 재확인했다. 코드 검증 4개 통과와 보안 감사 통과는 구분한다. 후속 내부 빌드 commit `e6c09cc20`도 같은 4개 통과·감사 차단이며, 승인된 APK의 클라우드·파일 검증은 위에 별도로 기록했다. 새 APK의 OTA·실기기 검증은 미실행이다.

## 잔여 위험과 다음 결정

- 로컬 반례 검증은 암호 구현 전체의 안전성 보증이나 제3자 보안 감사를 대체하지 않는다.
- braces의 범용 AST 크기·총 확장량·CPU/메모리 quota 전체를 새로 보장하지 않는다. 이번 패치는 깊이·순환으로 인한 stack/loop 문제를 다룬다.
- 기존 Backend high 예외 4건, Mobile moderate/low 및 개발 의존성 전체 감사 항목은 별도다. 이번 4개 advisory 검증을 전체 무취약 상태로 표현하지 않는다.
- 승인된 내부 APK의 EAS 클라우드 설치·빌드·파일 검증은 완료했다. `1.0.5 (7)` / runtime `1.0.5`로 분리했고 기존 `1.0.4` OTA로 게시하지 않았다. 실기기·장시간 검수와 공식 보안 차단 해소는 남아 있다.
- 공식 수정판이 나오면 백포트와 패치 의존성을 제거하고 같은 반례·앱 회귀를 다시 실행한다.

## 공식 근거

- [ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [JXL·HEIF advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
- [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [상위 제안 PR #88](https://github.com/micromatch/braces/pull/88)
- [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [상위 제안 PR #1159](https://github.com/digitalbazaar/forge/pull/1159)
