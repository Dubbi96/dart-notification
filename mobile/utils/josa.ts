// 한국어 조사 자동선택 유틸 (DAR-274)
//
// 동적 기업명·검색어 뒤에 받침 판별 없이 '을/를' 폼체(빈칸식)를 붙이면 품질이 떨어진다
// (삼성전'자'→'를', 한국전'력'→'을'). 한글 종성(받침) 유무로 자연 조사를 고른다.
//
// josa(word, pair) — word 의 마지막 글자 받침을 보고 pair 의 한쪽을 돌려준다.
//   pair 형식: '받침있을때/받침없을때' — 항상 받침 있는 형태가 앞.
//     을/를 · 이/가 · 은/는 · 으로/로,  그리고 와/과 는 '과/와' 로 전달(받침형 '과'가 앞).
//   '으로/로' 는 ㄹ 받침을 받침 없음처럼 다루는 한국어 예외를 반영한다.
//
// 한글이 아닌 종단(영문·숫자)은 한국어 발음 끝소리 기준으로 받침을 추정하고,
// 판별할 수 없으면 받침 없는 형태로 안전 폴백한다(예외/크래시 없음).

const HANGUL_BASE = 0xac00; // '가'
const HANGUL_END = 0xd7a3; // '힣'
const JONG_COUNT = 28; // 종성 가짓수(없음 포함)
const JONG_RIEUL = 8; // 종성 인덱스 8 == ㄹ

// 영문 알파벳 이름의 한국어 발음 끝소리에 받침이 있는 글자
//   L='엘'·M='엠'·N='엔'·R='알' → 받침,  그 외(K='케이' 등) → 없음
const BATCHIM_LETTERS = new Set(['l', 'm', 'n', 'r']);
// ㄹ 받침처럼 동작하는 영문 끝소리 ('으로/로' 예외용): R='알'
const RIEUL_LIKE_LETTERS = new Set(['r']);
// 숫자 발음 끝소리에 받침이 있는 글자: 0영·1일·3삼·6육·7칠·8팔
const BATCHIM_DIGITS = new Set(['0', '1', '3', '6', '7', '8']);
// ㄹ 받침처럼 동작하는 숫자 끝소리: 1일·7칠·8팔
const RIEUL_LIKE_DIGITS = new Set(['1', '7', '8']);

interface Batchim {
  /** 받침(종성)이 있는가 */
  has: boolean;
  /** 받침이 ㄹ(또는 ㄹ처럼 동작하는 발음)인가 — '으로/로' 예외용 */
  isRieul: boolean;
}

/** 앞뒤 공백을 제거한 뒤 마지막 글자를 돌려준다(빈 문자열이면 null). */
function lastChar(word: string): string | null {
  const trimmed = word.trim();
  return trimmed.length > 0 ? trimmed[trimmed.length - 1] : null;
}

/** 한 글자의 받침 정보를 판별한다. 판별 불가(한자·기호 등)면 null. */
function batchimOf(ch: string): Batchim | null {
  const code = ch.charCodeAt(0);
  if (code >= HANGUL_BASE && code <= HANGUL_END) {
    const jong = (code - HANGUL_BASE) % JONG_COUNT;
    return { has: jong !== 0, isRieul: jong === JONG_RIEUL };
  }
  const lower = ch.toLowerCase();
  if (lower >= 'a' && lower <= 'z') {
    return { has: BATCHIM_LETTERS.has(lower), isRieul: RIEUL_LIKE_LETTERS.has(lower) };
  }
  if (lower >= '0' && lower <= '9') {
    return { has: BATCHIM_DIGITS.has(lower), isRieul: RIEUL_LIKE_DIGITS.has(lower) };
  }
  return null;
}

/**
 * word 끝소리 받침에 맞는 조사를 돌려준다.
 * @param word 조사가 뒤따를 단어(기업명·검색어 등). null/빈값은 폴백.
 * @param pair '받침있을때/받침없을때' 형식의 조사 쌍(예: '을/를').
 */
export function josa(word: string | null | undefined, pair: string): string {
  const [withBatchim, withoutBatchim] = pair.split('/');
  const fallback = withoutBatchim ?? withBatchim ?? '';
  if (!word) return fallback;

  const ch = lastChar(word);
  if (ch === null) return fallback;

  const b = batchimOf(ch);
  if (b === null) return fallback;

  // '으로/로' 예외: ㄹ 받침은 받침 없음처럼 '로'
  if (withBatchim === '으로' && b.isRieul) return withoutBatchim;

  return b.has ? withBatchim : withoutBatchim;
}
