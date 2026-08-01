# AOS Operator Console — Production 운영 설계

Issue #583의 운영 배포와 후속 설계 정본이다. Admin은 로컬 개발 서버가 아니라 기존 OCI Always
Free micro1에서 정적 파일로 제공한다. Backend와 같은 인스턴스를 재사용하므로 추가 월 비용은 0원이다.

## 2026-08-01 운영 반영

- Admin URL: `https://admin.168.138.198.152.nip.io`
- Backend: AOS Rule Engine 포함 production image 배포, container `healthy`
- API: 무인증 Operator bootstrap 요청 `401` 확인(404 아님)
- Admin: index와 hashed JS/CSS `200`, production source map 0
- 보안: Let's Encrypt 인증서, CSP/HSTS/X-Frame-Options/nosniff/Permissions Policy 적용
- 화면: 1280×900과 375×812에서 horizontal overflow 0, console error 0
- 계정: 승인된 이메일을 bootstrap ADMIN으로 등록. 배포 시점 해당 이메일 DB 사용자 0건이므로
  정상 가입한 뒤 기존 앱 인증으로 로그인해야 한다. 실제 이메일은 운영 환경에만 보관한다.
- 변경 명령: `AOS_OPERATOR_MUTATIONS_ENABLED=false` 확인
- 비용: 기존 OCI Always Free와 Caddy 재사용, 추가 월 비용 0원

Backend 재생성 중 Docker가 종료된 구 컨테이너를 `removing` 상태에 남겨 새 컨테이너 시작이 지연됐다.
구 compose 프로세스를 종료하고 Docker daemon을 1회 재시작한 뒤 새 Backend만 `--no-deps`로 기동했다.
Redis는 restart policy로 정상 복귀했고, DB는 별도 micro2라 재기동 대상이 아니었다. 복구 후 Backend,
Redis, 내부·공개 health와 Operator 인증 경계를 모두 재검증했다.

## 현재 운영 구조

```text
Browser
  └─ HTTPS admin.168.138.198.152.nip.io (Caddy / Let's Encrypt)
       ├─ /, /assets/* → /var/www/aos-operator/current
       └─ /api/*       → 127.0.0.1:3000 (NestJS)
                              └─ private PostgreSQL 10.0.1.151:5432
```

- 정적 릴리스는 immutable 디렉터리에 보관하고 `current` symlink만 원자적으로 교체한다.
- Admin과 API를 same-origin으로 두어 별도 CORS 허용 범위를 만들지 않는다.
- CSP, frame 차단, MIME sniff 차단, HSTS, 최소 Permissions Policy를 Caddy에서 강제한다.
- production source map은 기본 생성하지 않는다.
- 로그인은 기존 앱 이메일/비밀번호 JWT를 재사용하고 서버 Operator RBAC를 추가 적용한다.
- 최초 운영자는 `AOS_OPERATOR_BOOTSTRAP_EMAILS`로 제한한다. 가입 전 이메일도 허용 목록에 둘 수
  있지만, 실제 인증은 해당 이메일의 정상 가입과 비밀번호 확인 이후에만 성립한다.
- `AOS_OPERATOR_MUTATIONS_ENABLED=false`가 운영 기본값이다. 현재 콘솔은 조회·감사 용도다.

## 화면 설계 원칙

1. 첫 화면은 원시 테이블보다 **지금 판단해야 할 상태**를 먼저 보여준다.
2. 상태 카드는 결론, 이유, 근거 시각, 다음 행동 순서로 읽히게 한다.
3. Strategy·Backtest·Shadow는 버전과 as-of를 항상 함께 표시해 서로 다른 기준의 숫자를 섞지 않는다.
4. 위험 상태와 Kill Switch는 색만으로 구분하지 않고 텍스트·아이콘·상태명을 함께 쓴다.
5. 모바일 폭에서는 표를 카드/요약으로 축약하고, 원장은 데스크톱 상세 화면에서 확인한다.
6. 변경 버튼은 조회 UI와 분리하고 사유·Step-up·영수증이 없으면 실행하지 않는다.
7. Admin은 LIVE 주문과 브로커 연결을 만들지 않는다.

## 비용 최소화 선택

| 선택지 | 월 추가비용 | 현재 판단 |
|---|---:|---|
| 기존 OCI micro1 + Caddy 정적 호스팅 | 0원 | 현재 채택. same-origin, 운영 단순성 우수 |
| Cloudflare Pages 정적 호스팅 | 무료 구간 가능 | 실도메인·Access 도입 시 후보. 현재는 CORS·호스트가 하나 더 생김 |
| Vercel/Netlify 무료 구간 | 무료 구간 가능 | 빌드·접근제어 제한과 외부 의존이 늘어 현재 보류 |
| 별도 VM/유료 App Hosting | 추가 비용 | 현재 트래픽과 정적 앱 특성상 불필요 |

## 단계별 운영 계획

### P0 — Read-only 운영

- Backend와 Admin HTTPS 배포
- 단일 bootstrap ADMIN 이메일
- Mutation 전역 OFF
- Strategy/Backtest/Shadow/배분/감사/Worker/Kill 상태 조회
- 헬스·로그·정적 자산·모바일 폭 검증

### P1 — 접근 통제 강화

- 실도메인 도입
- Cloudflare Access 또는 동급 SSO/2FA
- bootstrap env를 DB membership으로 전환
- VIEWER/EDITOR/APPROVER/RISK_OFFICER 역할별 계정 분리
- 관리자 접속 로그·보존기간·복구 절차 확정

### P2 — 제한적 변경 승인

- SSO/2FA와 역할 분리 완료 후에만 Mutation ON 검토
- 장후 Strategy/Weight 예약 변경만 허용
- 사유, 5분 Step-up, 단일 사용 grant, request/result hash 영수증 검증
- Kill Switch 발동은 허용하되 해제는 검토 요청만 유지

## 운영 금지선

- Admin 정적 페이지가 보인다는 이유로 Mutation을 켜지 않는다.
- AI가 주문을 결정하거나 Hard Risk Gate를 우회하지 않는다.
- 장중 Rule/Weight/Strategy Version을 바꾸지 않는다.
- 장기계좌 자산으로 시스템 트레이딩 손실을 자동 보전하지 않는다.
- 운영 DB 자격증명 교체 이슈(#581)는 본 배포와 분리한다.
