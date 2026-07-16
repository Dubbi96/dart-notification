# Standalone APK FCM 푸시 e2e 검증 절차 — DAR-521

> 목적: 스토어/사이드로드로 배포되는 **standalone(프로덕션 계열) APK**에서 FCM 푸시가
> 설치 → 토큰 발급 → 서버 발송 → 단말 수신까지 **끊김 없이 동작**함을 재현 가능하게 검증한다.
> 배경: 2026-06-26 "FCM V1 서버키·토큰검증 남음" 이후 완결 증거가 부재했던 항목의 종결.
> 정본 로드맵: `docs/roadmap/cc-pm-cycle1-plan-2026-07-17.md` §4 Wave B(에디션 배달, 선행: A4 + FCM e2e).
> dev build 파이프라인 전반은 [`../mobile-dev-build.md`](../mobile-dev-build.md), 네이티브 함정은
> [`../mobile-cross-platform-issues.md`](../mobile-cross-platform-issues.md) 참조.

## 0. 전달 경로 요약 (무엇을 검증하는가)

```
앱(google-services.json, sender 246941451126)
  └─ GmsCore(FCM) 가 네이티브 디바이스 토큰 발급           ← 단말/에뮬레이터 Google Play Services
       └─ getExpoPushTokenAsync → ExponentPushToken 매핑    ← Expo push 서비스
            └─ 백엔드 expo-server-sdk 로 Expo push API 발송  ← backend/src/expo-push/expo-push.service.ts
                 └─ Expo → FCM V1 (Google Service Account Key) ← Expo 프로젝트 자격증명(오너 콘솔에서 업로드)
                      └─ FCM → GmsCore → 앱이 시스템 알림 게시   ← 단말 수신
```

핵심: 백엔드는 **직접 FCM 을 호출하지 않는다**. `Expo` 로 보내고 Expo 가 FCM V1 로 배달한다.
따라서 "FCM V1 서버키"는 APK 안이 아니라 **Expo 프로젝트 자격증명**(Google Service Account Key)으로
업로드되어 있어야 한다. 이것이 6/26 잔여 항목의 실체였다.

## 1. 대상 산출물 (SUT)

| 항목 | 값 |
|---|---|
| EAS 빌드 ID | `442c3a18-e833-4ef7-aff7-c61e78f10cdb` (profile `oci`, channel `oci`) |
| 커밋 / 지문 | `468d7d0f…` / fingerprint `a6fb65bda21208bb1ad74f95f4be8295aeb4a3c5` |
| SDK / runtimeVersion | Expo SDK `56.0.0` / `1.0.0` (policy `appVersion`) |
| APK 아티팩트 | `https://expo.dev/artifacts/eas/q2SvxVe0eeGYNi8idKhJDlIcc6c3x0gJj5-NgJNIo0I.apk` (117,671,340 B) |
| 패키지 / 이름 / scheme | `com.gongsion.app` / `공시온` / `gongsion` |
| EXPO_PUBLIC_API_URL | `https://168.138.198.152.nip.io/api` |
| updates URL (EXPO_UPDATE_URL 배선판) | `https://u.expo.dev/2807bcb5-05c4-479f-b3be-2b40686cc7ed` (branch `oci`) |
| EAS projectId | `2807bcb5-05c4-479f-b3be-2b40686cc7ed` (`@duvbi/dart-alert`) |
| Firebase 프로젝트 / sender | `gongsion-7a24f` / `246941451126` (app id `1:246941451126:android:88da1464c8e6d867743057`) |

APK 안에는 raw `google-services.json` 이 아니라 컴파일된 리소스 문자열로 위 Firebase 값이 들어간다
(`unzip -p <apk> resources.arsc | strings | grep -E '1:[0-9]+:android|gongsion-7a24f'` 로 확인).

## 2. 검증 환경 — 에뮬레이터 dar_test

| 항목 | 값 | 판정 |
|---|---|---|
| AVD | `dar_test` (`~/.android/avd/dar_test.avd`) | — |
| API level | android-34 | — |
| 시스템 이미지 | `system-images/android-34/google_apis/arm64-v8a` (tag `google_apis`) | — |
| PlayStore.enabled | `no` | — |
| **Google Play Services** | `com.google.android.gms` **v23.18.18 설치됨** (+ `com.android.vending`) | ✅ FCM 가능 |

**판정: 에뮬레이터 dar_test 는 FCM 검증에 충분하다 → 실기기 불필요.**
근거: FCM(getDevicePushToken/getExpoPushToken 및 푸시 수신)은 **Google Play Services(GmsCore)** 만
있으면 동작하며, Play Store 앱(`google_apis_playstore` 이미지)은 필요치 않다. dar_test 는 `google_apis`
이미지지만 GmsCore v23.18.18 이 실재하므로 네이티브 FCM 토큰 발급과 배달이 정상 동작했다(§4에서 실증).
※ Play Store 인앱결제·업로드 트랙 검증이 목적이면 그때는 `google_apis_playstore` 이미지 또는 실기기가 필요하다.

## 3. 사전조건 — FCM V1 서버키(Expo 자격증명) 확인

6/26 잔여 항목의 실체. Expo GraphQL 로 프로젝트 Android 자격증명을 직접 조회한다.

```bash
SS=$(python3 -c "import json;print(json.load(open('$HOME/.expo/state.json'))['auth']['sessionSecret'])")
curl -s -X POST https://api.expo.dev/graphql \
  -H "Content-Type: application/json" -H "expo-session: $SS" \
  --data '{"query":"query($fn:String!){app{byFullName(fullName:$fn){androidAppCredentials{applicationIdentifier androidFcm{id} googleServiceAccountKeyForFcmV1{id clientEmail projectIdentifier}}}}}","variables":{"fn":"@duvbi/dart-alert"}}'
```

**결과(2026-07-17):**
- `androidFcm`: `null` — 레거시 FCM 서버키 미사용(정상, V1 로 이관 완료).
- `googleServiceAccountKeyForFcmV1`: **존재** — id `abb06470-a828-4de8-b4c7-ab3aff72a5f8`,
  clientEmail `firebase-adminsdk-fbsvc@gongsion-7a24f.iam.gserviceaccount.com`,
  projectIdentifier `gongsion-7a24f`.

→ **FCM V1 Google Service Account Key 가 Expo 프로젝트에 업로드되어 있다. 6/26 "서버키" 항목은 완료.**
그리고 이 키의 Firebase 프로젝트(`gongsion-7a24f`)가 APK 의 sender(`246941451126`/`gongsion-7a24f`)와
**정확히 일치**한다 → MismatchSenderId 위험 없음.

## 4. e2e 실행 절차 (재현)

전제: `adb`(`/opt/homebrew/bin`), 실행 중인 `dar_test` 에뮬레이터, `eas` 로그인(`duvbi`).
아래는 `export ANDROID_SERIAL=emulator-5554` 가정.

### 4-1. 설치 · 실행

```bash
curl -sL -o /tmp/dar.apk "https://expo.dev/artifacts/eas/q2SvxVe0eeGYNi8idKhJDlIcc6c3x0gJj5-NgJNIo0I.apk"
adb install -r -g /tmp/dar.apk                       # -g: 런타임 권한(POST_NOTIFICATIONS) 부여
adb shell am start -n com.gongsion.app/.MainActivity
# 확인: logcat 에 `ReactNativeJS: Running "main"`, `dev.expo.updates` 매니페스트(branch oci) 노출
```

권한 확인: `adb shell dumpsys package com.gongsion.app | grep POST_NOTIFICATIONS` → `granted=true`.

### 4-2. 네이티브 FCM 토큰 확보

앱의 인앱 토큰 등록 경로(`useNotificationSetup`)는 **로그인(카카오 OAuth) 이후**에만 서버로 등록한다.
그러나 Firebase 메시징 auto-init 은 앱 시작 시 네이티브 FCM 토큰을 이미 발급해 앱 저장소에 캐시한다.
헤드리스 검증에서는 이 캐시 토큰을 읽어 로그인 게이트를 우회한다(에뮬레이터이므로 `adb root` 가능).

```bash
adb root
adb shell "cat /data/data/com.gongsion.app/shared_prefs/com.google.android.gms.appid.xml"
# → <string name="|T|246941451126|*">{"token":"cA26…","appVersion":"1", …}</string>
```

`|T|246941451126|*` 의 sender 가 APK 의 sender(246941451126)와 일치 = 앱이 올바른 Firebase
프로젝트로 GmsCore 에 등록됨.

### 4-3. ExponentPushToken 매핑

네이티브 FCM 토큰을 Expo push 서비스에 교환한다(앱의 `getExpoPushTokenAsync` 와 동일 호출).
`projectId` 와 `experienceId` 는 배타적(둘 다 보내면 검증 오류) — `projectId` 만 보낸다.

```bash
curl -s -X POST https://exp.host/--/api/v2/push/getExpoPushToken \
  -H "Content-Type: application/json" \
  --data '{"deviceId":"<uuid>","appId":"com.gongsion.app","deviceToken":"<네이티브 FCM 토큰>","type":"fcm","development":false,"projectId":"2807bcb5-05c4-479f-b3be-2b40686cc7ed"}'
# → {"data":{"expoPushToken":"ExponentPushToken[…]"}}
```

### 4-4. 서버 발송 (Expo push API — 백엔드와 동일 경로)

백엔드 `ExpoPushService` 가 쓰는 것과 같은 Expo push API 로 발송한다. `channelId` 는 앱이 등록한
Android 채널(`disclosure`/`signal`/`trade`/`system`) 중 하나여야 OS 가 채널별로 묶어 표시한다.

```bash
curl -s -X POST https://exp.host/--/api/v2/push/send \
  -H "Content-Type: application/json" \
  --data '{"to":"ExponentPushToken[…]","title":"[삼성전자] 주요사항보고서(유상증자)","body":"오늘의 매수 신호 · 점수 82 · 한 줄 판단: 관심","channelId":"signal","priority":"high","sound":"default","data":{"deepLink":"dart://disclosure/20260717000123","kind":"SIGNAL"}}'
# → {"data":{"status":"ok","id":"<ticket-id>"}}          ← 발송 티켓(send log)
```

### 4-5. 수신 확인 + 배달 영수증

```bash
# 시스템이 게시한 알림 확인(제목/본문/채널/색상)
adb shell dumpsys notification --noredact | grep -A3 -E "삼성전자|pkg=com.gongsion"
adb shell cmd statusbar expand-notifications
adb exec-out screencap -p > receive.png              ← 수신 스크린샷

# Expo 배달 영수증(최종 상태)
curl -s -X POST https://exp.host/--/api/v2/push/getReceipts \
  -H "Content-Type: application/json" --data '{"ids":["<ticket-id>"]}'
# → {"data":{"<ticket-id>":{"status":"ok"}}}            ← 배달 확정
```

## 5. 실측 결과 (2026-07-17, dar_test / build 442c3a18) — PASS

| 링크 | 증거 | 상태 |
|---|---|---|
| APK 설치·실행 | `adb install Success`, `ReactNativeJS: Running "main"`, `dev.expo.updates` branch `oci` 매니페스트 | ✅ |
| EXPO_UPDATE_URL 배선 | 매니페스트 updates.url `u.expo.dev/2807bcb5…`, updateGroup `ab97afdc-7477-4826-96ae-8bb08491e5fb` | ✅ |
| FCM V1 서버키(Expo) | GraphQL: `googleServiceAccountKeyForFcmV1` 존재(`…@gongsion-7a24f`) | ✅ |
| sender 정합 | APK sender `246941451126`(gongsion-7a24f) = 자격증명 프로젝트 | ✅ |
| 네이티브 FCM 토큰 | `|T|246941451126|*` 캐시 토큰 확보 | ✅ |
| ExponentPushToken 매핑 | `ExponentPushToken[ahKiAoEQTpCM3EQwLP_F9E]` 발급 | ✅ |
| 서버 발송 | 티켓 `019f6d16-9420-7708-a729-661d148e804a` `status:ok` | ✅ |
| **단말 수신** | dumpsys: `pkg=com.gongsion.app tag=FCM-Notification:18737043 channel=signal importance=4` / title `[삼성전자] 주요사항보고서(유상증자)` / text `오늘의 매수 신호 · 점수 82 · 한 줄 판단: 관심` / color `0xff14b8a6` | ✅ |
| 배달 영수증 | getReceipts → `status:ok` | ✅ |

증거 파일: [`evidence/dar-521/receive-notification.png`](evidence/dar-521/receive-notification.png)(수신 스크린샷 — "공시온 • now" + 제목/본문),
[`evidence/dar-521/app-launch.png`](evidence/dar-521/app-launch.png),
[`evidence/dar-521/send-receipt-log.json`](evidence/dar-521/send-receipt-log.json)(발송 요청·티켓·영수증; 디바이스 토큰은 레다크션).

`tag=FCM-Notification:…` = FCM 경로로 도착했다는 증거(로컬/인앱 알림이 아님). `channel=signal`,
`color=0xff14b8a6`(#14B8A6, 앱 브랜드색)가 발송 요청과 정확히 일치 → 전 구간 무결.

## 6. DAR-446 혼재 토큰 폴백 회귀

한 요청에 서로 다른 Expo 프로젝트 토큰이 섞이면 Expo 가 요청 전체를 거부한다
("All push notification messages in the same request must be for the same project").
`ExpoPushService.sendPushNotifications` 는 이 충돌에 한해 **메시지 단위로 폴백 발송**해 정상 토큰
전달을 보존한다(그 외 오류는 종전대로 로그만 — DAR-260 정합 유지).

- 구현: `backend/src/expo-push/expo-push.service.ts` (`isProjectConflict` 분기).
- 회귀 테스트: `backend/src/expo-push/expo-push.receipt.spec.ts` §"혼재 프로젝트 토큰 …(DAR-446)"
  (정상 토큰 전달 + 충돌 토큰 스킵 / 일반 오류는 폴백 없이 로그만).

## 7. 정기 재검증 트리거

아래 중 하나라도 바뀌면 §4 를 재실행한다.
- APK 재빌드(신 URL·신 도메인 컷오버, 로드맵 owner-actions 참조) → 새 빌드 ID 로 §1 갱신 후 재실행.
- Expo 프로젝트 재링크·소유자 변경 → §3 GraphQL 자격증명 재확인.
- Firebase 프로젝트/서비스 계정 키 로테이션 → §3 재확인(clientEmail/projectIdentifier 정합).
- expo SDK 메이저 업그레이드 → getExpoPushToken 요청 스키마(§4-3) 변동 여부 확인.

## 8. 한계 / 주의

- 본 절차는 헤드리스 자동화를 위해 §4-2 에서 **Firebase auto-init 캐시 토큰**을 읽어 카카오 로그인
  게이트를 우회했다. 인앱 "설치→로그인→토큰 서버등록→발송" 전 구간을 사람이 손으로 확인하려면
  실사용자 카카오 로그인이 필요하다(대화형). 단, 발송→FCM V1→수신 배달 경로는 위 방식으로 동일하게 실증된다.
- §4-4 는 백엔드가 쓰는 것과 **같은 Expo push API**로 발송해 배달 경로를 검증한다. 백엔드 라우트
  (`/devices/register` → 알림 트리거)를 통한 발송은 서버 인증 세션이 필요하며 배달 경로 자체는 동일하다.
