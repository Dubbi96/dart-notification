# AOS Operator Console

AOS의 운영·감사·비상통제용 웹 콘솔입니다. 모바일 투자 판단 화면과 달리 전략 버전,
백테스트 근거, Shadow/Paper 원장, 대사 불일치, Worker 상태를 한곳에서 확인합니다.

## 로컬 실행

```bash
npm ci
cp .env.example .env.local
npm run dev
```

백엔드 없이 UI를 확인하려면 `VITE_AOS_OPERATOR_DEMO=1 npm run dev`를 사용합니다.

## 안전 기본값

- `AOS_OPERATOR_MUTATIONS_ENABLED=false`가 백엔드 기본값입니다.
- 변경 명령은 역할 권한과 범위별 5분 Step-up 인증을 모두 요구합니다.
- Step-up 토큰은 단 한 번만 사용할 수 있습니다.
- Kill Switch 해제 요청은 실제 해제를 자동 수행하지 않습니다.
- 이 콘솔은 실거래 주문을 생성하지 않습니다. Shadow/Paper 운영 원장만 다룹니다.

## 배포

`npm run build` 결과인 `dist/`를 정적 호스팅에 배포하고 API reverse proxy 또는
`VITE_API_BASE_URL`을 구성합니다. 운영 활성화 전에 운영자 멤버십, CORS, CSP, SSO,
감사 보존정책을 검토해야 합니다.
