// DAR-277 결정론 검증: 콘텐츠 화면 2곳의 중앙 ActivityIndicator → 스켈레톤(DAR-147 정렬).
// 1) app/disclosure/[id].tsx isLoading 분기 = <DetailSkeleton/> (중앙 스피너·loadingContainer 제거).
// 2) app/(tabs)/notifications/index.tsx 초기 로딩 = <SkeletonList variant="disclosure"/>.
// 3) 에러/빈상태 동선(ApiErrorState·EmptyState)·헤더 불변. 푸터 페이지네이션 스피너는 적합하므로 유지.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const detail = readFileSync(join(root, 'app/disclosure/[id].tsx'), 'utf8');
const notif = readFileSync(join(root, 'app/(tabs)/notifications/index.tsx'), 'utf8');

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

// 헬퍼: A와 B 사이 슬라이스(없으면 빈문자열)
function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i + a.length);
  return j < 0 ? src.slice(i) : src.slice(i + a.length, j);
}

// ---------- ① 공시 상세 ----------
ok('detail: DetailSkeleton import', /import \{ DetailSkeleton \} from '@components\/common\/DetailSkeleton'/.test(detail));
// isLoading 분기 본문(= `{isLoading ? (` ~ `) : isError`)에 DetailSkeleton 렌더
const detailLoadingBranch = between(detail, '{isLoading ? (', ') : isError');
ok('detail: isLoading 분기 존재', detailLoadingBranch.length > 0);
ok('detail: isLoading → <DetailSkeleton', /<DetailSkeleton/.test(detailLoadingBranch));
ok('detail: 스켈레톤 카드 spec(cards=) 지정', /cards=\{/.test(detailLoadingBranch));
ok('detail: 중앙 ActivityIndicator 제거(파일 전체 0건)', !/ActivityIndicator/.test(detail));
ok('detail: loadingContainer 스타일 제거', !/loadingContainer/.test(detail));
// 동선 불변: 에러/빈상태 분기 유지
ok('detail: 에러 분기 ApiErrorState 유지', /<ApiErrorState/.test(detail));
ok('detail: 빈상태 분기 EmptyState 유지', /<EmptyState/.test(detail));
// 헤더 유지: 로딩/에러/빈 공통 분기 내 뒤로가기+제목
ok('detail: 헤더 뒤로가기 유지', /onPress=\{\(\) => router\.back\(\)\}/.test(detail));
ok("detail: 헤더 제목 '공시 상세' 유지", /공시 상세/.test(detail));

// ---------- ② 알림 리스트 ----------
ok('notif: SkeletonList import', /import \{ SkeletonList \} from '@components\/common\/SkeletonCard'/.test(notif));
// 초기 로딩 분기: SkeletonList 렌더 + 중앙 loadingContainer 제거
ok('notif: 초기 로딩 → <SkeletonList variant="disclosure"', /<SkeletonList variant="disclosure"\s*\/>/.test(notif));
ok('notif: loadingContainer 스타일 제거', !/loadingContainer/.test(notif));
// 푸터 페이지네이션 스피너는 적합(인라인 small) → ActivityIndicator import·사용 유지가 정상
ok('notif: 푸터 ActivityIndicator(인라인 페이지네이션) 유지', /<ActivityIndicator size="small"/.test(notif));
// 동선 불변: 에러/빈상태 유지
ok('notif: 에러 분기 ApiErrorState 유지', /ApiErrorState/.test(notif));
ok('notif: 빈상태 분기 EmptyState 유지', /EmptyState/.test(notif));

// ---------- 회귀 대조(음성): 옛 패턴이 사라졌는지 ----------
ok('regression: detail 옛 중앙 스피너 패턴(ActivityIndicator size="large") 부재', !/ActivityIndicator size="large"/.test(detail));
ok('regression: notif 옛 중앙 스피너(loadingContainer + size="large") 부재', !(/loadingContainer/.test(notif) && /ActivityIndicator size="large"/.test(notif)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
