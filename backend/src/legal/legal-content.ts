/**
 * 갭분석 W3 — Play 컴플라이언스 공개 웹 페이지 정적 HTML.
 *
 * - PRIVACY_HTML: 개인정보 처리방침 — 본문은 mobile/app/legal/privacy.tsx 와 동일 내용을
 *   웹으로 재게시한 것이다(문안 수정 시 양쪽 동기화 필수).
 * - ACCOUNT_DELETION_HTML: 웹 계정삭제 안내 — Play 정책상 스토어 리스팅에 게시할
 *   "계정 삭제 방법" 공개 URL. 앱 내 탈퇴 경로 + 이메일 문의 경로를 안내한다.
 *
 * 인증 불요(공개), Swagger 제외. 라우트: GET /api/legal/privacy · /api/legal/account-deletion
 */

const BASE_STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 32px 20px 64px; max-width: 720px;
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
    line-height: 1.7; color: #1f2937; background: #ffffff;
    word-break: keep-all;
  }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  h2 { font-size: 1.05rem; margin: 28px 0 8px; }
  p, li { font-size: 0.95rem; }
  ul { padding-left: 20px; }
  .meta { color: #6b7280; font-size: 0.85rem; margin-bottom: 24px; }
  .footer { color: #6b7280; font-size: 0.85rem; margin-top: 40px; }
  .steps li { margin-bottom: 6px; }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e7eb; background: #111827; }
    .meta, .footer { color: #9ca3af; }
  }
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | 공시on</title>
<style>${BASE_STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export const PRIVACY_HTML = page(
  '개인정보 처리방침',
  `<h1>공시on 개인정보 처리방침</h1>
<p class="meta">시행일: 2026년 3월 9일</p>

<p>공시on(이하 "서비스")은 이용자의 개인정보를 중요시하며, 「개인정보 보호법」 등 관련 법령을 준수합니다. 본 개인정보 처리방침은 서비스가 수집하는 개인정보의 항목, 수집 목적, 보유 기간 등을 안내합니다.</p>

<h2>1. 수집하는 개인정보 항목</h2>
<p>서비스는 회원가입 및 서비스 제공을 위해 다음 정보를 수집합니다.</p>
<p><strong>[필수 항목]</strong></p>
<ul>
  <li>카카오 계정 고유 식별자 (카카오 ID)</li>
  <li>이름 (카카오 프로필 닉네임)</li>
  <li>이메일 주소 (카카오 계정 이메일)</li>
</ul>
<p><strong>[자동 수집 항목]</strong></p>
<ul>
  <li>기기 정보 (기기 식별자, OS 버전)</li>
  <li>푸시 알림 토큰 (Expo Push Token)</li>
  <li>서비스 이용 기록 (관심목록, 알림 설정)</li>
</ul>

<h2>2. 개인정보의 수집 및 이용 목적</h2>
<ul>
  <li>회원 식별 및 인증</li>
  <li>맞춤형 공시 알림 서비스 제공</li>
  <li>관심기업 관리 및 알림 발송</li>
  <li>서비스 개선 및 통계 분석</li>
  <li>고객 문의 및 불만 처리</li>
</ul>

<h2>3. 개인정보의 보유 및 이용 기간</h2>
<ul>
  <li>회원 탈퇴 시까지 보유하며, 탈퇴 즉시 파기합니다.</li>
  <li>단, 관련 법령에 의해 보존할 필요가 있는 경우 해당 기간 동안 보관합니다:
    <ul>
      <li>계약 또는 청약철회 등에 관한 기록: 5년</li>
      <li>소비자의 불만 또는 분쟁 처리에 관한 기록: 3년</li>
      <li>접속에 관한 기록: 3개월</li>
    </ul>
  </li>
</ul>

<h2>4. 개인정보의 제3자 제공</h2>
<p>서비스는 이용자의 개인정보를 원칙적으로 제3자에게 제공하지 않습니다. 다만, 이용자의 동의가 있거나 법령에 의해 요구되는 경우에는 예외로 합니다.</p>

<h2>5. 개인정보의 처리 위탁</h2>
<p>서비스는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁합니다.</p>
<ul>
  <li>클라우드 인프라(서버 호스팅 및 데이터 저장)</li>
  <li>Expo (Expo Application Services): 푸시 알림 발송</li>
</ul>

<h2>6. 이용자의 권리</h2>
<p>이용자는 언제든지 다음 권리를 행사할 수 있습니다.</p>
<ul>
  <li>개인정보 열람 요청</li>
  <li>개인정보 수정 요청</li>
  <li>개인정보 삭제 요청 (회원 탈퇴) — <a href="/api/legal/account-deletion">계정 삭제 안내</a></li>
  <li>개인정보 처리 정지 요청</li>
</ul>
<p>위 권리 행사는 앱 내 설정 또는 고객센터를 통해 가능합니다.</p>

<h2>7. 개인정보의 파기</h2>
<p>서비스는 개인정보 보유 기간의 경과, 처리 목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.</p>
<ul>
  <li>전자적 파일: 복구 불가능한 방법으로 영구 삭제</li>
  <li>기타 기록물: 파쇄 또는 소각</li>
</ul>

<h2>8. 개인정보 보호책임자</h2>
<ul>
  <li>책임자: 공시on 운영팀</li>
  <li>이메일: support@gongsion.com</li>
</ul>
<p>개인정보 침해에 대한 신고나 상담이 필요한 경우 아래 기관에 문의할 수 있습니다.</p>
<ul>
  <li>개인정보침해신고센터 (privacy.kisa.or.kr / 118)</li>
  <li>개인정보분쟁조정위원회 (kopico.go.kr / 1833-6972)</li>
</ul>

<h2>9. 개인정보 처리방침 변경</h2>
<p>본 개인정보 처리방침은 법령, 정책 또는 서비스 변경에 따라 수정될 수 있으며, 변경 시 앱 내 공지를 통해 안내합니다.</p>

<p class="footer">본 개인정보 처리방침은 2026년 3월 9일부터 시행합니다.</p>`,
);

export const ACCOUNT_DELETION_HTML = page(
  '계정 삭제 안내',
  `<h1>공시on 계정 삭제 안내</h1>
<p class="meta">공시on 앱의 계정과 관련 데이터를 삭제하는 방법을 안내합니다.</p>

<h2>1. 앱에서 직접 탈퇴 (즉시 삭제)</h2>
<ol class="steps">
  <li>공시on 앱 실행 후 로그인</li>
  <li><strong>설정 → 프로필</strong> 화면으로 이동</li>
  <li>화면 하단의 <strong>회원 탈퇴</strong> 선택</li>
  <li>안내를 확인하고 탈퇴를 확정하면 계정이 즉시 삭제됩니다</li>
</ol>

<h2>2. 이메일로 삭제 요청</h2>
<p>앱에 접근할 수 없는 경우, 가입에 사용한 카카오 계정 이메일로
<a href="mailto:support@gongsion.com">support@gongsion.com</a> 에 계정 삭제를 요청할 수 있습니다.
본인 확인 후 지체 없이 처리해 드립니다.</p>

<h2>3. 삭제되는 데이터</h2>
<p>탈퇴 시 다음 데이터가 <strong>즉시 영구 삭제</strong>되며 복구할 수 없습니다.</p>
<ul>
  <li>계정 정보 (카카오 식별자, 이름, 이메일)</li>
  <li>관심기업 목록, 저장한 공시</li>
  <li>알림 설정 및 알림 수신 이력</li>
  <li>포트폴리오 및 관련 기록</li>
  <li>등록된 기기 및 푸시 알림 토큰, 로그인 세션(토큰) 전부</li>
</ul>

<h2>4. 보관되는 데이터</h2>
<ul>
  <li>관련 법령에 따라 보존 의무가 있는 기록은 해당 법정 기간 동안만 분리 보관 후 파기합니다 (전자상거래법 등).</li>
  <li>검색·이용 통계는 개인 식별 정보를 제거(익명화)한 형태로만 보존됩니다.</li>
</ul>

<p class="footer">문의: support@gongsion.com · <a href="/api/legal/privacy">개인정보 처리방침</a></p>`,
);
