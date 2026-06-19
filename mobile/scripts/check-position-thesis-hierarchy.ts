// DAR-359 결정론 검증: 포지션 상세 위계(손익% 지배) + 테제 조건행 컬러 스캔.
// ① position/index.tsx: 손익%가 typo.amount(최상위) + 이익/손실 전폭 색조(successSurface/
//    errorSurface) + 방향 화살표(trending-up/down)로 결과를 글랜스. 현재가는 서브라인,
//    수량·평단은 하단 메타섹션(작은 폰트·낮은 불투명도).
// ② position/thesis.tsx ConditionRow: 전폭 배경색(위반=errorSurface, 충족=successSurface,
//    중립=surfaceSecondary) + 좌측 솔리드 컬러바 + 아이콘 19px + 위반 라벨 볼드.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const detail = readFileSync(
  join(root, 'app/portfolio/[portfolioId]/position/[positionId]/index.tsx'),
  'utf8',
);
const thesis = readFileSync(
  join(root, 'app/portfolio/[portfolioId]/position/[positionId]/thesis.tsx'),
  'utf8',
);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}

function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i + a.length);
  return j < 0 ? src.slice(i) : src.slice(i + a.length, j);
}

// ======================= ① 상세 위계(GROUND-1) =======================
// 부호 판정: pnlColor 결과를 success/error 와 비교(반올림 정합) → 색조/화살표 결정.
ok('detail: pnlTextColor=pnlColor(반올림 정합) 도출', /pnlTextColor\s*=\s*position\s*\?\s*pnlColor\(/.test(detail));
ok('detail: isProfit=success / isLoss=error 부호 판정',
   /isProfit\s*=\s*pnlTextColor\s*===\s*colors\.success/.test(detail) &&
   /isLoss\s*=\s*pnlTextColor\s*===\s*colors\.error/.test(detail));
// 전폭 색조: 이익 successSurface / 손실 errorSurface / 보합 중립.
ok('detail: pnlSurface 이익=successSurface', /isProfit[\s\S]{0,40}colors\.successSurface/.test(detail));
ok('detail: pnlSurface 손실=errorSurface', /colors\.errorSurface/.test(detail));
// 방향 화살표.
ok('detail: pnlArrow trending-up/down/minus', /trending-up['"]\s*:\s*isLoss\s*\?\s*['"]trending-down/.test(detail));

// 손익% 지배 블록: typo.amount + 화살표 아이콘 + pnlSurface 배경.
const pnlBlock = between(detail, 'styles.pnlBlock', '입력값 메타');
ok('detail: pnlBlock 블록 추출', pnlBlock.length > 0);
ok('detail: pnlBlock 배경=pnlSurface', /backgroundColor:\s*pnlSurface/.test(pnlBlock));
ok('detail: 손익% typo.amount(지배 글꼴)', /typo\.amount,\s*\{\s*color:\s*pnlTextColor/.test(pnlBlock));
ok('detail: 손익 화살표 Feather name={pnlArrow} size 28', /name=\{pnlArrow\}\s*size=\{28\}/.test(pnlBlock));
ok('detail: 현재가 서브라인(typo.caption) pnlBlock 내부', /typo\.caption,[\s\S]{0,120}현재가/.test(pnlBlock));

// 입력값 메타: 작은 폰트 + 낮은 불투명도 + 상단 디바이더로 위계 분리.
const meta = between(detail, '입력값 메타', '</Surface>');
ok('detail: 메타 수량·평단 typo.small + opacity 0.75', /typo\.small,[\s\S]{0,60}opacity:\s*0\.75/.test(meta));
ok('detail: 메타 상단 borderTop 디바이더', /styles\.metaSection/.test(meta) && /metaSection:\s*\{[\s\S]*?borderTopWidth:\s*1/.test(detail));
ok('detail: 메타 수량·평단 렌더 보존', /\{position\.quantity\}주 · 평균/.test(meta));

// 회귀 음성 대조: 옛 위계(손익%가 typo.h3 동급) 제거 확인.
ok('detail(regression): 옛 손익 typo.h3 인라인 pnlRow 패턴 부재',
   !/typo\.h3,\s*\{\s*color:\s*pnlColor\(position\.pnlPercent/.test(detail));

// ======================= ② 테제 스캔(GROUND-2) =======================
const row = between(thesis, 'function ConditionRow', 'export default');
ok('thesis: ConditionRow 블록 추출', row.length > 0);
// 상태 3분기: 위반 / 충족(isMet) / 중립.
ok('thesis: isMet=!isViolation && violated(충족 분기)', /isMet\s*=\s*!isViolation\s*&&\s*item\.violated/.test(row));
ok('thesis: accentColor 위반=error/충족=success/중립=textTertiary',
   /accentColor\s*=\s*isViolated\s*\?\s*colors\.error\s*:\s*isMet\s*\?\s*colors\.success\s*:\s*colors\.textTertiary/.test(row));
// 전폭 배경색.
ok('thesis: rowSurface 위반=errorSurface', /isViolated[\s\S]{0,30}colors\.errorSurface/.test(row));
ok('thesis: rowSurface 충족=successSurface', /isMet[\s\S]{0,20}colors\.successSurface/.test(row));
ok('thesis: rowSurface 중립=surfaceSecondary', /colors\.surfaceSecondary/.test(row));
ok('thesis: conditionRow 배경 적용', /styles\.conditionRow,\s*\{\s*backgroundColor:\s*rowSurface/.test(row));
// 좌측 솔리드 컬러바.
ok('thesis: 좌측 conditionBar accentColor 바', /styles\.conditionBar,\s*\{\s*backgroundColor:\s*accentColor/.test(row));
ok('thesis: conditionBar width 4 정의', /conditionBar:\s*\{\s*width:\s*4/.test(thesis));
// 아이콘 18-20px(=19) 솔리드.
ok('thesis: 아이콘 size 19(18-20 범위)', /size=\{19\}/.test(row));
ok('thesis: 아이콘 name 위반=x-circle/충족=check-circle/중립=circle',
   /iconName\s*=\s*isViolated\s*\?\s*['"]x-circle['"]\s*:\s*isMet\s*\?\s*['"]check-circle['"]\s*:\s*['"]circle['"]/.test(row));
// 위반 라벨 볼드.
ok('thesis: 위반 텍스트 볼드(fontWeight 700)', /fontWeight:\s*isViolated\s*\?\s*['"]700['"]/.test(row));
// 섹션 분리 유지(진입 논리 / 훼손 조건 디바이더).
ok('thesis: 진입 논리/훼손 조건 섹션 헤더 분리 유지',
   /▌ 진입 논리/.test(thesis) && /▌ 훼손 조건/.test(thesis));

// 회귀 음성 대조: 옛 텍스트 접미('← 위반') 단독 구분 제거.
ok('thesis(regression): 옛 텍스트 접미 " ← 위반" 부재', !/' ← 위반'/.test(thesis));
ok('thesis(regression): 옛 size 15 소형 아이콘 부재', !/size=\{15\}/.test(thesis));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
