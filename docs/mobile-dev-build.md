# 모바일 Dev Build 파이프라인 (Galaxy/Android) — DAR-114

> 목적: Galaxy(Android) 실기기에서 **재현 가능하게** dev build를 만들고 설치·검증하며, PR 단계에서 Android 빌드 회귀를 자동 차단한다.
> 스택: Expo SDK 56 · React Native 0.85.3 · New Architecture(Fabric) · `expo-dev-client` ~56.0.18.
> 배경/네이티브 함정은 [`mobile-cross-platform-issues.md`](./mobile-cross-platform-issues.md) 참조.

이 프로젝트는 `expo-dev-client`가 들어있어 **원래 development build 전제**다. Expo Go는 RN 0.85/Fabric에서 `refreshControl` 등 네이티브 이슈에 취약했으므로(현재는 수정으로 동작), 장기 안정 경로는 dev build다.

---

## ① Dev build 생성 절차

### A. EAS Build (권장 — 클라우드, Galaxy 직접 설치용 APK)

전제: Expo 계정(`owner: yuna_kim`), `eas-cli` 설치, `extra.eas.projectId` 설정됨(`app.json`).

```bash
cd mobile
npm i -g eas-cli            # 최초 1회
eas login                   # 최초 1회
eas whoami                  # 로그인 확인

# development 빌드(= expo-dev-client 포함, internal 배포). Galaxy에 직접 설치 가능한 APK.
eas build --profile development --platform android

# 또는 preview(서버 ALB URL 고정, dev-client 없는 순수 APK — QA 배포용)
eas build --profile preview --platform android
```

- 빌드 완료 후 EAS가 주는 **QR/URL**을 Galaxy 브라우저로 열어 APK 다운로드·설치.
- 프로파일 정의: `mobile/eas.json`
  - `development`: `developmentClient: true`, `distribution: internal` → **dev build**. API URL은 고정하지 않음(Metro/LAN에서 주입 — ③ 참조).
  - `preview`: `buildType: apk` + `EXPO_PUBLIC_API_URL`(ALB) 고정 → 서버 붙은 QA 빌드.
  - `production`: `buildType: app-bundle`(Play 제출용).

### B. 로컬 `expo run:android` (Android SDK가 깔린 Mac에서)

전제: Android Studio/SDK, `ANDROID_HOME`, JDK 17, USB 디버깅 켠 Galaxy 또는 에뮬레이터.

```bash
cd mobile
npx expo run:android                 # 네이티브 프로젝트 생성(prebuild) + 빌드 + 설치
# 기기 연결 확인:
adb devices                          # Galaxy가 'device'로 보여야 함
```

- 최초 실행 시 `android/` 네이티브 디렉터리를 prebuild로 생성한다(gitignore 상태 — 산출물 커밋 금지).
- 이후 JS만 바뀌면 dev build 설치본 + Metro(`npm run start:lan`)로 충분하다(재빌드 불필요).

---

## ② Galaxy 실기기 설치·검증 절차

1. **APK 설치**
   - EAS: 빌드 URL/QR → Galaxy 다운로드 → "출처를 알 수 없는 앱 설치" 허용 → 설치.
   - 로컬: `adb install -r <path>.apk` (또는 `expo run:android`가 자동 설치).
2. **Metro 연결**: Mac에서 `cd mobile && npm run start:lan` (③). dev build 앱을 열면 dev menu에서 Metro 번들러로 연결.
3. **백엔드 준비**: `docker-compose -f docker-compose.dev.yml up -d` → `cd backend && npx prisma migrate deploy` → `npm run start:dev`. `:3000/health`에서 dart/krx/llm 키 확인. (미적용 마이그레이션 → `/signals` 500 함정 주의.)
4. **검증 체크리스트(자동화 가능)**
   - `adb shell screencap`/`adb exec-out screencap -p > shot.png` 으로 스크린샷.
   - `adb shell input tap/swipe` 로 탭/스크롤 재현.
   - 딥링크: `adb shell am start -a android.intent.action.VIEW -d "gongsion://signals"` (scheme=`gongsion`).
   - **회귀 핵심**: 홈·신호·알림·포트폴리오 탭에서 FlatList **헤더+아이템+스크롤** 정상 렌더(과거 Android 백지 버그 재발 감시).

---

## ③ Metro LAN 설정 가이드

Galaxy 실기기는 Mac과 **같은 Wi-Fi**에 있어야 하고, Metro와 API가 `localhost`가 아닌 **Mac의 LAN IP**로 잡혀야 한다.

```bash
cd mobile
npm run start:lan          # = scripts/start-lan.sh : LAN IP 자동감지 후 env 주입 + expo start --lan
npm run start:lan -- --go  # Expo Go 폴백
```

`scripts/start-lan.sh`가 자동으로 설정하는 값:

| 변수 | 의미 | 예시 |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | 앱이 호출할 백엔드 베이스 URL | `http://192.168.0.17:3000/api` |
| `REACT_NATIVE_PACKAGER_HOSTNAME` | Metro 번들러 호스트(기기가 접속할 주소) | `192.168.0.17` |

- 수동 실행 시:
  ```bash
  EXPO_PUBLIC_API_URL=http://<Mac LAN IP>:3000/api \
  REACT_NATIVE_PACKAGER_HOSTNAME=<Mac LAN IP> \
  npx expo start --lan
  ```
- 오버라이드: `API_PORT=3000 IFACE=en1 npm run start:lan` (포트/네트워크 인터페이스).
- **Wi-Fi가 바뀌면 IP가 바뀌므로 `start:lan`을 다시 실행**한다.

---

## ④ CI 게이트 (Android 번들 + 타입체크)

`.github/workflows/mobile-ci.yml` — `mobile/**` 변경 PR/푸시에서 실행.

| 게이트 | 명령 | 성격 |
|---|---|---|
| 타입체크 | `npm run typecheck` (`tsc --noEmit`) | **하드**(에러 시 머지 차단) |
| Android 번들 | `npm run bundle:android` (`expo export --platform android`) | **하드**(Hermes 번들 실패 시 차단) |
| 번들 산출물 확인 | `dist-ci/_expo/static/js/android` 존재 검증 | **하드** |
| ESLint | `npm run lint` | **비차단**(현재 main에 사전 존재 에러 15건 → `continue-on-error`, 추세만 관찰) |

- Android 번들 게이트는 Expo Go가 가리는 **번들/네이티브 회귀를 PR에서** 잡는 핵심 장치다.
- 로컬에서 동일 게이트 재현: `cd mobile && npm run typecheck && npm run bundle:android`.

---

## 산출물 위치
- `mobile/eas.json` — EAS 빌드 프로파일(development/preview/production).
- `mobile/scripts/start-lan.sh` — Metro LAN 시작 헬퍼.
- `mobile/package.json` — `start:lan` / `typecheck` / `bundle:android` 스크립트.
- `.github/workflows/mobile-ci.yml` — CI 게이트.
