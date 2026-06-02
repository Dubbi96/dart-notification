# 개발 환경 셋업 — Expo Go 테스트 + 카카오 OAuth

> 작성: 2026-06-02 · 대상: 로컬 개발/실기기(Expo Go) 테스트

## 0. 네트워크 전제
- 개발 PC LAN IP: **192.168.0.17** (바뀌면 `ipconfig getifaddr en0` 로 재확인 후 아래 값 수정)
- 휴대폰과 PC가 **같은 Wi-Fi**에 있어야 함
- 백엔드는 `0.0.0.0:3000` 바인딩(기본) → 폰에서 `http://192.168.0.17:3000` 접근 가능
- macOS 방화벽이 켜져 있으면 node 인바운드 허용 필요(시스템 설정 > 네트워크 > 방화벽)

## 1. 환경변수 (이미 생성됨, 키만 채우면 됨)

### backend/.env (gitignored)
```
DATABASE_URL=...(5432, 설정됨)
DART_API_KEY=...(설정됨)
API_BASE_URL="http://192.168.0.17:3000/api"     # 카카오 redirect_uri 매칭에 사용
KAKAO_REST_API_KEY="..."                          # ← 채우기
KAKAO_CLIENT_SECRET=""                            # 카카오 Client Secret 사용 시에만
```

### mobile/.env (gitignored)
```
EXPO_PUBLIC_API_URL=http://192.168.0.17:3000/api
EXPO_PUBLIC_KAKAO_REST_API_KEY=...                # ← 채우기 (backend KAKAO_REST_API_KEY 와 동일 값)
EXPO_PUBLIC_APP_ENV=development
```

> 카카오 키는 **모바일·백엔드가 같은 앱의 REST API 키**여야 한다. (mobile = authorize 요청 client_id, backend = code→token 교환 client_id)

## 2. 카카오 개발자 콘솔 설정 (https://developers.kakao.com)

1. **내 애플리케이션 > 애플리케이션 추가** (또는 기존 앱 사용)
2. **앱 키 > REST API 키** 복사 → `KAKAO_REST_API_KEY` / `EXPO_PUBLIC_KAKAO_REST_API_KEY` 에 입력
3. **카카오 로그인 > 활성화 ON**
4. **카카오 로그인 > Redirect URI 등록** (정확히 일치해야 함):
   ```
   http://192.168.0.17:3000/api/auth/kakao/callback
   ```
5. **동의항목**: 닉네임(기본), 이메일(선택 — 미동의 시 백엔드가 `kakao_{id}@kakao.user` 로 대체)
6. (선택) **보안 > Client Secret** 사용 시 발급값을 `KAKAO_CLIENT_SECRET` 에 입력. 안 쓰면 빈 값 유지.

> ⚠️ 카카오가 raw IP redirect URI 등록을 거부하면, 대안: `ngrok http 3000` 또는 `npx expo start --tunnel` 로 받은 **https 주소**를 `API_BASE_URL` / `EXPO_PUBLIC_API_URL` 양쪽에 쓰고, 그 콜백 URL을 카카오에 등록.

## 3. 실행 순서

```bash
# 1) DB (이미 기동돼 있으면 생략)
docker compose -f docker-compose.dev.yml up -d

# 2) 백엔드 (LAN 바인딩, 3000)
cd backend && npm run start:dev
#  → http://192.168.0.17:3000/api/docs 가 폰 브라우저에서 열리면 도달성 OK

# 3) 모바일 (Expo Go)
cd mobile && npx expo start
#  → 터미널 QR을 'Expo Go' 앱(SDK 55)으로 스캔
```

## 4. 카카오 로그인 플로우 (구현 방식)
앱 → `WebBrowser`로 카카오 authorize 페이지 오픈 → 로그인 → 카카오가 `http://192.168.0.17:3000/api/auth/kakao/callback?code&state` 로 리다이렉트 → 백엔드가 code→token 교환·유저 생성 후 결과 저장 → 앱이 `/auth/kakao/result?state` 폴링으로 토큰 수신. (네이티브 카카오 SDK 불필요 → **Expo Go 호환**)

## 5. 알려진 제약
- **푸시 알림**: Expo Go(SDK 53+) + Android에서는 원격 푸시 미지원 → 푸시는 Dev Build에서 테스트. 인증/화면 테스트는 Expo Go로 가능.
- LAN IP는 네트워크 바뀌면 갱신 필요(위 1·2의 IP 모두 동기화).
