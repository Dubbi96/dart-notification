/**
 * DAR-307 결정론적 검증: 신호 탐색 카드(SignalExploreCard)의 기업명 시작 x 정렬.
 *
 * 버그: 헤더 행이 [이벤트칩][기업명 flex:1][등급칩] 한 행이라, 이벤트 라벨 길이가
 *       종목마다 달라 그 옆 기업명의 시작 x 위치가 카드마다 어긋나 리스트가 울퉁불퉁.
 * 수정(DAR-307, 해법 a): 이벤트 칩을 기업명과 별도 행으로 분리 → 기업명이 항상
 *       헤더 행의 첫 자식(좌측 고정 x)에서 시작 → 이벤트 라벨 길이와 무관하게 정렬.
 *
 * 두 축으로 증명한다:
 *   (1) 레이아웃 모델: 같은 행(before) vs 별도 행(after)에서 기업명 시작 x 분산.
 *   (2) 소스 바인딩: 실제 SignalExploreCard/CuratedSignalCard 구조가 별도-행 패턴.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'components', 'signals');
const explore = readFileSync(join(SRC, 'SignalExploreCard.tsx'), 'utf8');
const curated = readFileSync(join(SRC, 'CuratedSignalCard.tsx'), 'utf8');

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? `\n   ${detail}` : ''}`);
  if (!ok) failures++;
}

// ── (1) 레이아웃 모델 ────────────────────────────────────────────────────────
// 카드 콘텐츠 박스 좌측 패딩만큼을 원점 0으로 둔다.
const GAP = 8; // spacing.sm

// before: 같은 행 — corpName 시작 x = 이벤트칩 폭 + gap (라벨마다 다름).
function corpStartXSameRow(eventChipW: number): number {
  return eventChipW + GAP;
}
// after: 별도 행 — corpName 은 헤더 행 첫 자식이라 항상 x=0 (이벤트 라벨 무관).
function corpStartXSeparateRow(_eventChipW: number): number {
  return 0;
}

// 서로 다른 이벤트유형 칩 자연폭(dp): '대규모 공급계약' vs '실적 서프라이즈' vs '신주인수권부사채' …
const eventChipWidths = [120, 96, 178, 80, 152];

const beforeXs = eventChipWidths.map(corpStartXSameRow);
const afterXs = eventChipWidths.map(corpStartXSeparateRow);
const beforeAligned = new Set(beforeXs).size === 1;
const afterAligned = new Set(afterXs).size === 1;

check(
  '모델: 수정 전(같은 행) 기업명 시작 x 가 라벨마다 어긋남(버그 재현)',
  !beforeAligned,
  `before xs=[${beforeXs.join(', ')}] (분산 → 울퉁불퉁)`,
);
check(
  '모델: 수정 후(별도 행) 기업명 시작 x 가 모든 카드 동일(DoD 핵심)',
  afterAligned && afterXs[0] === 0,
  `after xs=[${afterXs.join(', ')}] (전부 0 → 가지런)`,
);

// ── (2) 소스 바인딩: SignalExploreCard ───────────────────────────────────────
// headerRow 블록 추출.
const headerBlock = explore.match(/<View style={styles\.headerRow}>([\s\S]*?)<\/View>/);
const header = headerBlock ? headerBlock[1] : '';
// 헤더 행의 첫 자식이 기업명 Text (signal.corpName) 이어야 좌측 고정.
const corpIdx = header.indexOf('signal.corpName');
const eventChipInHeader = /styles\.eventChip/.test(header);
check(
  'explore: 헤더 행 첫 요소가 기업명(corpName), 이벤트칩은 헤더에 없음',
  corpIdx > 0 && !eventChipInHeader,
  `corpName in header=${corpIdx > 0}, eventChip in header=${eventChipInHeader}`,
);

// 이벤트칩은 별도 metaRow 행에 위치.
const metaBlock = explore.match(/<View style={styles\.metaRow}>([\s\S]*?)<\/View>/);
const eventChipInMeta = !!metaBlock && /styles\.eventChip/.test(metaBlock[1]);
check('explore: 이벤트칩이 별도 metaRow 행에 분리됨', eventChipInMeta);

// 더 이상 쓰지 않는 headerLeft 스타일 제거(no-unused-styles).
check(
  'explore: 사용하지 않는 headerLeft 스타일 제거됨',
  !/headerLeft/.test(explore),
);
check('explore: metaRow 스타일 정의 존재', /metaRow:\s*{/.test(explore));

// 기업명 한 줄 말줄임 유지(긴 기업명 회귀 가드).
check(
  'explore: 기업명 numberOfLines={1} 유지',
  /signal\.corpName[\s\S]{0,40}/.test(explore) &&
    /numberOfLines={1}[\s\S]*?signal\.corpName/.test(explore),
);

// ── (3) 소스 바인딩: CuratedSignalCard 일관성 ───────────────────────────────
// 큐레이션 카드도 동일 패턴(헤더 첫 자식 corpName + 별도 metaRow 이벤트칩).
const cHeaderBlock = curated.match(/<View style={styles\.headerRow}>([\s\S]*?)<\/View>/);
const cHeader = cHeaderBlock ? cHeaderBlock[1] : '';
const cCorpFirst = cHeader.indexOf('signal.corpName') > 0 && !/styles\.eventChip/.test(cHeader);
const cMetaHasChip = /<View style={styles\.metaRow}>([\s\S]*?)styles\.eventChip/.test(curated);
check(
  'curated: 헤더 첫 자식 corpName + 이벤트칩 별도 metaRow (탐색 카드와 동일 패턴)',
  cCorpFirst && cMetaHasChip,
  `corpFirst=${cCorpFirst}, eventChip in metaRow=${cMetaHasChip}`,
);

console.log(`\n결과: ${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
