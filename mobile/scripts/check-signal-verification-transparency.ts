/**
 * TRUST-02 · SCR-GAP-10 · CONF-02 결정론적 검증 — 신호 검증 투명성 표면.
 *
 * 정적 소스 바인딩 검증(런타임 무관·결정론):
 * 1) TRUST-02 (components/portfolio/SignalAccuracySection.tsx + types/signal-accuracy.types.ts):
 *    등급별 정확도 1차 수치 = 중앙값(robustExcessReturn, API 기존 필드). 평균(avgExcessReturn)은
 *    보조 표기로 강등. 승률 병기 유지. InfoSheet 에 '평균은 극단치에 민감' 설명 1줄.
 * 2) SCR-GAP-10 (app/portfolio/auto-trading.tsx):
 *    정직 고지에 '매수 로직 재검증 진행 중' 1줄 추가(기존 notice 패턴).
 * 3) CONF-02 (app/portfolio/backtest-track-record.tsx):
 *    헤더에 '검증 상태' 뱃지 1개 — 카피는 '매수 로직 재검증 진행 중 (참고)' 수준만.
 *    ★불합격 수치·rankCorr 등 구체 수치 절대 비노출(2회차 확정값만 표면화 방침).
 *    DataLimitBadge 톤(warning 테두리 + 아이콘 + 평문) 재사용.
 *
 * 실행: npx -y tsx@4 scripts/check-signal-verification-transparency.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

/**
 * 비노출 가드는 "렌더되는 문자열" 대상 — 주석(비렌더)은 제외하고 검사한다.
 * (방침 자체를 설명하는 코드 주석에 금지 토큰이 등장하는 것은 노출이 아니다.)
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function main() {
  const root = join(__dirname, '..');

  // ── 1) TRUST-02: 타입 계약 ───────────────────────────────────────
  const types = readFileSync(join(root, 'types', 'signal-accuracy.types.ts'), 'utf8');
  console.log('types/signal-accuracy.types.ts');
  assert('robustExcessReturn 필드(백엔드 계약 동기화)', /robustExcessReturn:\s*number\s*\|\s*null/.test(types));

  // ── 1) TRUST-02: 정확도 표면 ─────────────────────────────────────
  const accuracy = readFileSync(
    join(root, 'components', 'portfolio', 'SignalAccuracySection.tsx'),
    'utf8',
  );
  console.log('components/portfolio/SignalAccuracySection.tsx');
  assert(
    '1차 수치 = 중앙값(robustExcessReturn) 표기',
    /\{formatReturnPct\(h\.robustExcessReturn\)\}/.test(accuracy),
  );
  assert(
    '1차 색조도 중앙값 기준(returnColor(h.robustExcessReturn…))',
    /returnColor\(h\.robustExcessReturn\s*\?\?\s*0/.test(accuracy),
  );
  assert(
    '평균은 보조 표기로 강등(평균 + avgExcessReturn)',
    /평균 \{formatReturnPct\(h\.avgExcessReturn\)\}/.test(accuracy),
  );
  assert(
    '평균이 1차 색조로 잔존하지 않음',
    !/returnColor\(h\.avgExcessReturn/.test(accuracy),
  );
  assert('승률 병기 유지', /승률 \{formatWinRate\(h\.winRate\)\}/.test(accuracy));
  assert('표본 병기 유지', /표본 \{h\.sampleCount\}/.test(accuracy));
  assert('InfoSheet 도입', /import \{ InfoSheet.*\} from '@components\/common\/InfoSheet'/.test(accuracy) && /<InfoSheet\b/.test(accuracy));
  assert("InfoSheet: '평균은 극단치에 민감' 설명", /평균은 극단치에 민감/.test(accuracy));
  assert(
    'info 버튼 접근성(role+label)',
    /accessibilityRole="button"[\s\S]*?accessibilityLabel="신호 정밀도 수치 설명 보기"/.test(accuracy),
  );
  assert('info 버튼 유효 터치영역 44pt(hitSlop)', /hitSlop=\{INFO_HIT_SLOP\}/.test(accuracy));
  assert(
    'a11y 라벨도 중앙값 1차·평균 보조 순서',
    /중앙값 초과수익 \$\{formatReturnPct\(h\.robustExcessReturn\)\}, 평균/.test(accuracy),
  );
  assert('하드코딩 색상 0(# 리터럴 없음)', !/#[0-9a-fA-F]{3,6}\b/.test(accuracy));

  // ── 2) SCR-GAP-10: 자동매매 상태 정직 고지 ───────────────────────
  const auto = readFileSync(join(root, 'app', 'portfolio', 'auto-trading.tsx'), 'utf8');
  console.log('app/portfolio/auto-trading.tsx');
  assert("'매수 로직 재검증 진행 중' 고지 1줄", /매수 로직 재검증 진행 중/.test(auto));
  assert(
    '기존 notice 패턴 재사용(styles.notice + surfaceSecondary)',
    /styles\.notice,\s*\{ backgroundColor: colors\.surfaceSecondary \}[\s\S]*?매수 로직 재검증 진행 중/.test(auto),
  );
  assert('참고용 한정 카피(단정·지시 아님)', /확정 전까지 성과·신호는 참고용입니다/.test(auto));

  // ── 3) CONF-02: 트랙레코드 검증 상태 뱃지 ────────────────────────
  const backtest = readFileSync(
    join(root, 'app', 'portfolio', 'backtest-track-record.tsx'),
    'utf8',
  );
  console.log('app/portfolio/backtest-track-record.tsx');
  assert('검증 상태 뱃지 컴포넌트', /function VerificationStatusBadge\(\)/.test(backtest));
  assert('헤더 1개소 렌더', (backtest.match(/<VerificationStatusBadge\s*\/>/g) ?? []).length === 1);
  assert("카피: '매수 로직 재검증 진행 중 (참고)' 수준만", /매수 로직 재검증 진행 중 \(참고\)/.test(backtest));
  assert(
    'a11y: 검증 상태 라벨',
    /accessibilityLabel="검증 상태: 매수 로직 재검증 진행 중\. 확정 전까지 참고용입니다\."/.test(backtest),
  );
  assert(
    'DataLimitBadge 톤 재사용(warning 테두리+아이콘+평문)',
    /borderColor: colors\.warning/.test(backtest) &&
      /<Feather name="alert-triangle" size=\{11\} color=\{colors\.warning\}/.test(backtest),
  );
  assert('칩 폰트스케일 캡(MAX_CHIP_FONT_SCALE)', /maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/.test(backtest));

  // ── 3) CONF-02 ★가드: 재검증 구체 수치 절대 비노출(렌더 문자열 기준) ─
  for (const [name, src] of [
    ['auto-trading', stripComments(auto)],
    ['backtest-track-record', stripComments(backtest)],
  ] as const) {
    assert(`${name}: rankCorr 비노출`, !/rankCorr/i.test(src));
    assert(`${name}: '불합격' 판정 문구 비노출`, !/불합격/.test(src));
  }

  console.log('');
  if (failures > 0) {
    console.error(`FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main();
