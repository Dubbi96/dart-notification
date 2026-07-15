/**
 * SEC EDGAR PoC 스파이크 (갭분석 W8 · M13A 진입 기준의 'EDGAR 실적 이벤트 파이프라인 PoC' 선행)
 * ─────────────────────────────────────────────────────────────────────────────
 * 스크래치 스크립트 — prod 미배포·NestJS 모듈 미등록. 검증 목적만:
 *   (1) EDGAR full-text search(공개 API, 키 불요)가 8-K 를 질의로 찾을 수 있는가
 *   (2) 회사별 최신 제출 목록(data.sec.gov/submissions)에서 8-K 최신 목록을 뽑을 수 있는가
 *   (3) 그 결과가 engine1 수집 경계 인터페이스(DartDisclosureItem → Disclosure 자연키)에
 *       타입/필드 수준으로 맞아떨어지는가 (import type 으로 컴파일 타임 검증)
 *
 * 실행 (backend 의 node_modules · tsconfig 재사용 — --project 명시 필수, 생략 시 ts-node 가 조용히 무시):
 *   cd backend && npx ts-node --project ./tsconfig.json ../scripts/edgar-poc.ts
 *
 * SEC 요구사항: User-Agent 헤더 필수(연락처 포함) + 10 req/s 이하 → 요청 간 250ms 지연(≤4 req/s).
 *
 * ─── 실행 결과 기록 (2026-07-16, 실제 실행 — EXIT 0) ────────────────────────
 * [A] full-text search (q="results of operations", forms=8-K): total=10000(ES 상한 캡),
 *     hit 에 accession(_id)·cik·display_names(티커 포함)·file_date 존재 → 키 없이 질의 가능 확인.
 * [B] Tesla(CIK 0001318605) submissions JSON: 최신 8-K 5건 추출 성공 —
 *     2026-07-02 0001628280-26-046717 / 04-22 0001628280-26-026551 / 04-02 0001628280-26-022956
 *     / 01-28 0001628280-26-003837 / 01-02 0001628280-26-000016, 전건 items=[2.02(실적),9.01].
 *     accessionNumber / filingDate / form / items / primaryDocument 컬럼 배열 제공.
 * [C] 매핑 검증: 표본 전건이 engine1 DartDisclosureItem 필수 필드로 무손실 매핑
 *     (rcpNo←accessionNumber[전역 유일], corpCode←CIK 10자리, rcpDt←filingDate→YYYYMMDD,
 *      report_nm←form+items, stock_code←submissions.tickers) → 판정 PASS.
 * 결론: 어댑터 계층(cc-multi-asset-expansion.md §5)에서 Scheduler/수집 포트 재사용 가능.
 *       갭 2건 — (1) DART XML 파서 재사용 불가(8-K 는 HTML/iXBRL, US 전용 경량 파서 필요),
 *       (2) corp_cls 에 US 시장 구분 없음(Y/K/N/E → 어댑터에서 확장). 쿼터 제약은 DART 일일쿼터보다 관대.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// import type → 컴파일 타임에만 사용(런타임 NestJS 의존 없음). 이 타입에 대입이 성립하면
// EDGAR 응답이 engine1 수집 경계(DartDisclosureItem) 형태에 맞는다는 것이 타입 수준에서 증명된다.
import type { DartDisclosureItem } from '../backend/src/engine1-disclosure/dart-api/dart-api.service';

// SEC 요구: 연락 가능한 UA. 10 req/s 이하 유지(여기선 요청 간 250ms → 최대 4 req/s).
const USER_AGENT = 'gongsion-edgar-poc/0.1 (contact: yrs03001@hanyang.ac.kr)';
const THROTTLE_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastRequestAt = 0;
async function fetchWithUa(url: string): Promise<Response> {
  // 단순 직렬 스로틀 — 직전 요청과 최소 THROTTLE_MS 간격 보장.
  const wait = lastRequestAt + THROTTLE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  return res;
}

// ── [A] EDGAR full-text search (efts.sec.gov) ────────────────────────────────
interface EftsHit {
  _id: string; // "{accessionNumber}:{fileName}"
  _source: {
    ciks: string[];
    display_names: string[]; // "Tesla, Inc.  (TSLA)  (CIK 0001318605)"
    file_type?: string;
    file_date?: string; // YYYY-MM-DD
    root_forms?: string[];
  };
}
interface EftsResponse {
  hits: { total: { value: number }; hits: EftsHit[] };
}

// ── [B] 회사별 제출 목록 (data.sec.gov/submissions) ──────────────────────────
interface SubmissionsResponse {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[]; // YYYY-MM-DD
      form: string[];
      items: string[]; // 8-K item 코드 (예: "2.02,9.01")
      primaryDocument: string[];
    };
  };
}

/** EDGAR 레코드 → engine1 수집 경계(DartDisclosureItem) 매핑. 대입이 곧 형태 검증. */
function toEngine1Item(row: {
  cik: string;
  companyName: string;
  ticker: string;
  form: string;
  items: string;
  accessionNumber: string;
  filingDate: string;
}): DartDisclosureItem {
  return {
    corp_code: row.cik.padStart(10, '0'), // Company.corpCode 자연키 자리 (US 는 CIK 10자리)
    corp_name: row.companyName,
    stock_code: row.ticker, // US 티커 (KR 6자리와 형식만 다름 — String 컬럼이라 수용 가능)
    corp_cls: 'U', // 신설 필요: US 시장 구분 (DART 의 Y/K/N/E 에 없음 → 어댑터에서 확장)
    report_nm: row.items ? `${row.form} (Item ${row.items})` : row.form,
    rcept_no: row.accessionNumber, // Disclosure.rcpNo 자연키 자리 — EDGAR accession 은 전역 유일
    flr_nm: row.companyName,
    rcept_dt: row.filingDate.replace(/-/g, ''), // YYYY-MM-DD → YYYYMMDD (DART 규격 정규화)
    rm: 'EDGAR',
  };
}

/** 자연키 관점 최소 검증: rcpNo(유일)·corpCode·rcpDt·report_nm 이 비어있지 않은가. */
function verdictFor(items: DartDisclosureItem[]): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.rcept_no) reasons.push('rcept_no(→rcpNo) 누락');
    if (seen.has(it.rcept_no)) reasons.push(`rcept_no 중복: ${it.rcept_no}`);
    seen.add(it.rcept_no);
    if (!/^\d{10}$/.test(it.corp_code)) reasons.push(`corp_code 10자리 아님: ${it.corp_code}`);
    if (!/^\d{8}$/.test(it.rcept_dt)) reasons.push(`rcept_dt YYYYMMDD 아님: ${it.rcept_dt}`);
    if (!it.report_nm) reasons.push('report_nm 누락');
  }
  return { pass: reasons.length === 0, reasons };
}

async function main(): Promise<void> {
  console.log('=== SEC EDGAR PoC (갭분석 W8) — 수집 형태 검증 ===\n');

  // [A] full-text search: 실적 관련 8-K 를 질의로 찾을 수 있는가
  const ftsUrl =
    'https://efts.sec.gov/LATEST/search-index?q=%22results%20of%20operations%22&forms=8-K';
  const fts = (await (await fetchWithUa(ftsUrl)).json()) as EftsResponse;
  console.log(`[A] full-text search(8-K, "results of operations"): total=${fts.hits.total.value}`);
  for (const hit of fts.hits.hits.slice(0, 3)) {
    console.log(
      `    - accession=${hit._id.split(':')[0]} cik=${hit._source.ciks[0]} date=${hit._source.file_date} name=${hit._source.display_names?.[0]}`,
    );
  }

  // [B] 회사별 최신 8-K 목록 (Tesla, CIK 1318605)
  const subUrl = 'https://data.sec.gov/submissions/CIK0001318605.json';
  const sub = (await (await fetchWithUa(subUrl)).json()) as SubmissionsResponse;
  const recent = sub.filings.recent;
  const latest8k = recent.form
    .map((form, i) => ({ form, i }))
    .filter(({ form }) => form === '8-K')
    .slice(0, 5)
    .map(({ i }) => ({
      cik: sub.cik,
      companyName: sub.name,
      ticker: sub.tickers?.[0] ?? '',
      form: recent.form[i],
      items: recent.items[i],
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
    }));
  console.log(`\n[B] ${sub.name} (${sub.tickers?.join(',')}) 최신 8-K ${latest8k.length}건:`);
  for (const f of latest8k) {
    console.log(`    - ${f.filingDate} ${f.accessionNumber} items=[${f.items}]`);
  }

  // [C] engine1 수집 경계(DartDisclosureItem) 매핑 + 자연키 판정
  const mapped = latest8k.map(toEngine1Item);
  const verdict = verdictFor(mapped);
  console.log('\n[C] engine1 DartDisclosureItem 매핑 표본:');
  console.log(JSON.stringify(mapped[0], null, 2));
  console.log(
    `\n판정: ${verdict.pass ? 'PASS — 어댑터 계층에서 수집 포트 재사용 가능' : 'FAIL'}`,
  );
  if (!verdict.pass) verdict.reasons.forEach((r) => console.log(`  · ${r}`));
  console.log(
    '\n비고: 원문은 https://www.sec.gov/Archives/edgar/data/{cik}/{accession없는하이픈}/{primaryDocument} 로 fetch 가능.',
  );
  console.log('      DART XML 파서는 재사용 불가(8-K 는 HTML/iXBRL) — US 전용 경량 파서 필요.');
  console.log('      corp_cls 는 DART Y/K/N/E 에 US 구분이 없어 어댑터에서 확장 필요.');
}

main().catch((error) => {
  console.error('PoC 실패:', error);
  process.exitCode = 1;
});
