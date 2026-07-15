/**
 * 수급(투자자별 매매동향)·공매도 소스 검증 스파이크 (갭분석 W16 ①)
 *
 * 실행: cd backend && npx ts-node --transpile-only scripts/live-investor-flow-smoke.ts
 *   (.env 는 cwd(backend/) 또는 SMOKE_ENV_PATH 로 주입 — live-krx-smoke.ts 패턴 재사용)
 *
 * 목적: W16 수집기(InvestorFlowDaily·ShortSellingDaily)의 1차/폴백 소스 확정.
 *   1) 현 KRX AUTH_KEY 로 KRX 정보데이터시스템 오픈API 투자자별 거래실적·공매도 상품 실호출
 *      (ETF 401 선례 — 상품별 구독 게이트가 실증돼 있어 선검증 필수, DAR-330/DAR-484)
 *   2) KIS 국내주식 종목별 투자자매매동향(inquire-investor, FHKST01010900) 스모크
 *   3) KIS 국내주식 공매도 일별추이(daily-short-sale, FHPST04830000) 스모크
 *
 * ─── 실행 결과 기록 (2026-07-16 07:24 KST, 실호출) ──────────────────────────
 *   [KRX] 대조군 sto/stk_bydd_trd     → HTTP 200, 0행(당일 T 미게시 — 키·일봉 구독 자체는 정상)
 *   [KRX] sto/stk_invstr_trd          → HTTP 404 (상품/슬러그 부재 — 오픈API 카탈로그에 투자자별 상품 없음)
 *   [KRX] sto/stk_bydd_invstr_trd     → HTTP 404 (동일)
 *   [KRX] srt/stk_srtsell_bal_bydd    → HTTP 404 (공매도 상품 부재 — srt 카테고리 미제공)
 *   [KIS] inquire-investor(FHKST01010900) → HTTP 200 MCA00000, output 30행(최근 ~30영업일).
 *         필드: stck_bsop_date·prsn_ntby_qty·frgn_ntby_qty·orgn_ntby_qty(주 단위) +
 *               prsn_ntby_tr_pbmn·frgn_ntby_tr_pbmn·orgn_ntby_tr_pbmn(★백만원 단위 대금 —
 *               실측: frgn_ntby_qty=1,799,843주 × ≈₩280,000 ≈ ₩5.04e11 = 509,525 백만원과 일치).
 *         ★당일(미마감) 행은 전 필드 빈 문자열 placeholder — 어댑터에서 필터 필수.
 *   [KIS] daily-short-sale(FHPST04830000) → HTTP 200 MCA00000, output 100행(일별).
 *         필드: stck_bsop_date·ssts_cntg_qty(공매도 체결수량)·ssts_tr_pbmn(공매도 거래대금, 원)·
 *               ssts_vol_rlim(당일 거래량 대비 비중%)·acml_ssts_cntg_qty(조회기간 누적 — 잔고 아님).
 *         ★공매도 '잔고'(shortBalanceQty/Ratio)는 미포함 — 무료 소스 미가용(KRX T+2 공표 별도 상품).
 *         ★당일(미마감) 행은 acml_vol=0 placeholder — 어댑터에서 필터 필수.
 *   ⇒ 소스 확정: 1차 = KIS(투자자별·공매도 거래 모두 가용), KRX = 어댑터 인터페이스만(상품 부재 404).
 *     공매도 잔고는 null 저장(정직) + 거래량·거래비중 축 우선. publishedDate 는 T+2 영업일 보수 계산.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// .env 해석 우선순위: SMOKE_ENV_PATH(명시) → 스크립트 기준 backend/.env → cwd/.env
const envCandidates = [
  process.env.SMOKE_ENV_PATH,
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
].filter((p): p is string => Boolean(p));
for (const p of envCandidates) {
  dotenv.config({ path: p });
}

import axios from 'axios';

const KRX_API_KEY = process.env.KRX_API_KEY ?? '';
const KRX_BASE_URL = (process.env.KRX_BASE_URL ?? 'https://data-dbg.krx.co.kr/svc/apis').replace(
  /^http:\/\//,
  'https://',
);
const KIS_BASE_URL = (
  process.env.KIS_BASE_URL ?? 'https://openapi.koreainvestment.com:9443'
).replace(/^http:\/\//, 'https://');
const KIS_APP_KEY = process.env.KIS_APP_KEY ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';

const SAMPLE_STOCK = '005930'; // 삼성전자 — 유동성 최대 표본

function lastWeekday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1); // EOD 데이터는 전일 기준이 안전
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
const SAMPLE_DATE = process.env.SMOKE_DATE ?? lastWeekday();

interface ProbeResult {
  label: string;
  status: string;
  rows: number;
  note?: string;
}
const summary: ProbeResult[] = [];

function section(title: string): void {
  console.log(`\n${'═'.repeat(64)}\n  ${title}\n${'═'.repeat(64)}`);
}

async function probeKrx(label: string, pathSeg: string, params: Record<string, string>) {
  section(`[KRX] ${label} (${pathSeg})`);
  try {
    const { data, status } = await axios.get(`${KRX_BASE_URL}/${pathSeg}`, {
      params: { ...params, AUTH_KEY: KRX_API_KEY },
      headers: { AUTH_KEY: KRX_API_KEY },
      timeout: 30_000,
      validateStatus: () => true,
    });
    const rows: unknown[] =
      (data as Record<string, unknown[]>)?.['OutBlock_1'] ??
      (data as Record<string, unknown[]>)?.['output'] ??
      [];
    console.log(`  HTTP ${status} / 레코드 ${Array.isArray(rows) ? rows.length : 0}개`);
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`  첫 행 키: ${Object.keys(rows[0] as object).join(', ')}`);
      console.log(`  첫 행: ${JSON.stringify(rows[0]).slice(0, 400)}`);
    } else if (status === 200) {
      console.log(`  응답 최상위 키: ${JSON.stringify(Object.keys(data ?? {}))}`);
    }
    summary.push({
      label: `KRX ${pathSeg}`,
      status: `HTTP ${status}`,
      rows: Array.isArray(rows) ? rows.length : 0,
      note: status === 401 ? '미구독(구독 게이트)' : status === 404 ? '상품/슬러그 부재' : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  호출 실패: ${msg}`);
    summary.push({ label: `KRX ${pathSeg}`, status: `ERROR ${msg}`, rows: 0 });
  }
}

async function kisToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) {
    console.log('  KIS_APP_KEY/KIS_APP_SECRET 미설정 — KIS 스모크 스킵');
    return null;
  }
  try {
    const { data } = await axios.post(`${KIS_BASE_URL}/oauth2/tokenP`, {
      grant_type: 'client_credentials',
      appkey: KIS_APP_KEY,
      appsecret: KIS_APP_SECRET,
    });
    return (data?.access_token as string) ?? null;
  } catch (e) {
    console.log(`  KIS 토큰 발급 실패: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function probeKis(
  token: string,
  label: string,
  pathSeg: string,
  trId: string,
  params: Record<string, string>,
) {
  section(`[KIS] ${label} (${pathSeg}, tr_id=${trId})`);
  try {
    const { data, status } = await axios.get(`${KIS_BASE_URL}${pathSeg}`, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: KIS_APP_KEY,
        appsecret: KIS_APP_SECRET,
        tr_id: trId,
        custtype: 'P',
      },
      params,
      timeout: 30_000,
      validateStatus: () => true,
    });
    const rows: unknown[] = Array.isArray(data?.output)
      ? data.output
      : Array.isArray(data?.output2)
        ? data.output2
        : [];
    console.log(
      `  HTTP ${status} / msg_cd=${data?.msg_cd ?? '-'} msg=${String(data?.msg1 ?? '').trim()} / 레코드 ${rows.length}개`,
    );
    if (rows.length > 0) {
      console.log(`  첫 행 키: ${Object.keys(rows[0] as object).join(', ')}`);
      console.log(`  첫 행: ${JSON.stringify(rows[0]).slice(0, 600)}`);
      if (rows.length > 1) console.log(`  둘째 행: ${JSON.stringify(rows[1]).slice(0, 600)}`);
    }
    summary.push({ label: `KIS ${pathSeg}`, status: `HTTP ${status} (${data?.msg_cd ?? '-'})`, rows: rows.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  호출 실패: ${msg}`);
    summary.push({ label: `KIS ${pathSeg}`, status: `ERROR ${msg}`, rows: 0 });
  }
}

async function main(): Promise<void> {
  console.log('수급·공매도 소스 검증 스파이크 (W16 ①)');
  console.log(`시각: ${new Date().toISOString()} / 기준일: ${SAMPLE_DATE} / 표본: ${SAMPLE_STOCK}`);
  console.log(`KRX 키: ${KRX_API_KEY ? '설정됨' : '미설정'} / KIS 키: ${KIS_APP_KEY ? '설정됨' : '미설정'}`);

  // ── 1. KRX 오픈API — 투자자별·공매도 상품 프로브 (+ 대조군 일봉) ─────────
  if (KRX_API_KEY) {
    await probeKrx('대조군: 유가 일봉(구독 확인)', 'sto/stk_bydd_trd', {
      basDd: SAMPLE_DATE,
      isuCd: SAMPLE_STOCK,
    });
    await probeKrx('투자자별 거래실적(후보 슬러그 1)', 'sto/stk_invstr_trd', { basDd: SAMPLE_DATE });
    await probeKrx('투자자별 거래실적(후보 슬러그 2)', 'sto/stk_bydd_invstr_trd', { basDd: SAMPLE_DATE });
    await probeKrx('공매도 잔고(후보 슬러그)', 'srt/stk_srtsell_bal_bydd', { basDd: SAMPLE_DATE });
  } else {
    console.log('\nKRX_API_KEY 미설정 — KRX 프로브 스킵');
  }

  // ── 2. KIS — 투자자별 매매동향 + 공매도 일별추이 ─────────────────────────
  const token = await kisToken();
  if (token) {
    await probeKis(
      token,
      '종목별 투자자매매동향',
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      'FHKST01010900',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: SAMPLE_STOCK },
    );
    await probeKis(
      token,
      '공매도 일별추이',
      '/uapi/domestic-stock/v1/quotations/daily-short-sale',
      'FHPST04830000',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: SAMPLE_STOCK,
        FID_INPUT_DATE_1: '',
        FID_INPUT_DATE_2: SAMPLE_DATE,
      },
    );
  }

  // ── 요약 ──────────────────────────────────────────────────────────────────
  section('결과 요약 (스크립트 상단 주석에도 기록)');
  for (const r of summary) {
    console.log(`  ${r.label.padEnd(56)} ${r.status.padEnd(24)} rows=${r.rows}${r.note ? ` (${r.note})` : ''}`);
  }
}

main().catch((e) => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
