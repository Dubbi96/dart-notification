# APK 릴리스 준비 감사 — v1.0.1 (DAR-569)

> 기준: `origin/main` 874d17275 · 감사일 2026-07-27 · 대상: Android `play-apk`

## 1. 기준선

- 현재 주 작업 디렉터리 `feat/gap-deploy-script`는 `origin/main`보다 67커밋 뒤이며 앱 차이는 없고 서버 배포 스크립트 1개만 추가되어 있다.
- 사용자 소유 미커밋 문서 3개가 있어 주 작업 디렉터리는 변경하지 않았다.
- 릴리스 작업은 `origin/main`에서 만든 `feat/DAR-569-release-readiness` worktree에서 수행한다.
- GitHub Issues가 저장소에서 비활성화되어 Issue 생성은 불가능하다. 연속 작업 ID `DAR-569`를 브랜치·PR 추적 ID로 사용한다.
- DAR-568 알림 seen 배선은 별도 PR #548로 열려 있어 중복 편입하지 않는다.

## 2. 감사 결과와 조치

| 렌즈 | 발견 | 판정·조치 |
|---|---|---|
| 디자인 | adaptive icon 배경이 Expo 템플릿 가이드 이미지, monochrome icon이 Expo 기본 심볼 | 두 잘못된 참조 제거. 브랜드 foreground와 teal 배경색만 유지 |
| 디자인 | legacy splash 필드가 SDK 56 스키마에서 거부됨 | `expo-splash-screen` 플러그인으로 이관, light/dark 배경 명시 |
| 기획/카피 | 백엔드 EventType 4종이 모바일 라벨 맵에 없음 | 구체적인 한국어 라벨과 단위테스트 추가 |
| 릴리스 | `1.0.0 / versionCode 1` 고정 | `1.0.1 / versionCode 2`로 올리고 runtimeVersion 경계 분리 |
| 안정성 | Expo 호환 패치 11종 지연, `expo-font` peer dependency 누락 | SDK 56 권장 버전 정렬, standalone 필수 모듈 추가 |
| 보안 | Axios 직접 의존성에 high advisory | 1.18.1로 갱신. 프로덕션 high/critical 0으로 정리 |
| 검증 기법 | 134개 결정론 검사가 CI에서 실행되지 않음 | 일괄 runner와 `quality:checks` 추가, PR CI 하드 게이트 편입 |
| 검증 기법 | 5개 검사기가 리팩터링 전 코드 모양만 찾아 거짓 실패 | 현재 JSX 줄바꿈·wrapper·신규 query key 계약으로 동기화 |
| 테스트 | React Query GC 타이머와 Expo 아이콘 비동기 폰트 로드가 Jest open handle/`act` 경고로 남음 | `gcTime: Infinity` + 아이콘 테스트 더블 + CI `forceExit` 종료 상한 적용 |

## 3. 검증 게이트

- `npx expo install --check`
- `npx expo-doctor` (21/21)
- `npm run typecheck`
- `npm run lint` (errors 0)
- `npm test -- --runInBand`
- `npm run quality:checks` (134/134)
- `npm run bundle:android` (`play` 환경 플래그)
- EAS `play-apk` remote build 및 APK 다운로드/무결성 확인

## 4. 의도적으로 남긴 항목

- 로컬 Android emulator/ADB 기기가 없어 설치 후 실화면 Maestro 검증은 APK를 실기기에 설치하는 단계로 남긴다.
- Expo Web은 `react-native-web`이 설치되지 않은 비대상 플랫폼이라 브라우저 시각 검증에 사용하지 않았다. 이번 산출물은 Android APK다.
- 전체 npm audit의 잔여 high는 Jest/ESLint 등 개발 도구 체인이다. `--omit=dev` 프로덕션 감사에는 moderate Expo config-plugin 체인만 남고 high/critical은 0이다.
- Play Console 제출용 `submit.play` 자동화와 서비스 계정 키는 APK 생성 범위 밖이며, `cc-play-submission-checklist.md`의 오너 액션으로 유지한다.
- OCI 프로덕션 배포와 `prisma migrate deploy`는 수행하지 않는다.
