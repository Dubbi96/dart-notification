/**
 * DAR-554 — docs/mobile-design-rules.md(R-1~R-20) 정본 통합 스캐너("check-design-rules"로 승격,
 * 문서 "강제 수단" 표 예정 항목). AST(@babel/parser+traverse) 기반 정적 스캔으로 4개 룰 위반을 찾는다:
 *
 *   R-1  한 줄 보장 3종 세트: numberOfLines={1} Text는 ellipsizeMode + (flexShrink|flex) + minWidth 동반.
 *   R-2  칩·배지 배율 상한: chip/badge/segment/tag/pill 스타일은 고정 height 대신 minHeight,
 *        해당 스타일이 걸린 Text/Chip에는 maxFontSizeMultiplier 필수.
 *   R-4  숫자 잘림 금지: 금액/점수/카운트류 식별자를 렌더하는 Text에 numberOfLines 사용 금지.
 *   R-11 카드 균일 높이: 캐러셀/그리드 반복 카드 스타일(card 계열)의 고정 height 사용 후보 — 수동 확인 필요.
 *
 * 정적 휴리스틱이라 과탐 가능 — 각 위반은 파일:라인과 근거를 출력해 사람이 트리아지한다.
 * Run: npx tsc scripts/check-design-rules.ts --ignoreConfig --ignoreDeprecations "6.0" --module commonjs
 *   --target es2021 --esModuleInterop --skipLibCheck --types node --outDir scripts && node scripts/check-design-rules.js
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

const ROOT = join(__dirname, '..');
const SCAN_DIRS = ['components', 'app'];

interface Violation {
  rule: string;
  file: string;
  line: number;
  detail: string;
}
const violations: Violation[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      walk(p, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

const files: string[] = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

const NUMERIC_NAME = /amount|price|Price|Amount|score|Score|count|Count|pct|Pct|percent|Percent|krw|Krw|KRW|Won|수익률|가격|금액|평가|잔고|equity|Equity|pnl|PnL|balance|Balance|formatReturnPct|formatExitRulePct|formatWinRate|formatSignedScore|formatPnlPercent|formatUnreadBadge|toLocaleString|returnPct|winRate|cumulativeReturn/;
const CHIPLIKE_STYLE_NAME = /chip|Chip|badge|Badge|segment|Segment|\btag\b|Tag|pill|Pill/;
// 카드 "컨테이너" 스타일만(예: card, signalCard, previewCard) — cardIcon/cardHeader 등 카드 하위요소는 제외.
const CARD_STYLE_NAME = /(^card$|[a-z]card$)/i;

function getAttr(openingElement: t.JSXOpeningElement, name: string): t.JSXAttribute | undefined {
  return openingElement.attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && a.name.name === name,
  );
}

function numberOfLinesValue(openingElement: t.JSXOpeningElement): number | 'dynamic' | undefined {
  const attr = getAttr(openingElement, 'numberOfLines');
  if (!attr) return undefined;
  const v = attr.value;
  if (!v) return 'dynamic';
  if (t.isJSXExpressionContainer(v)) {
    if (t.isNumericLiteral(v.expression)) return v.expression.value;
    return 'dynamic';
  }
  return 'dynamic';
}

// styles.xxx / typo.xxx 형태의 MemberExpression 이름 추출.
function memberStyleName(node: t.Node): { obj: string; key: string } | null {
  if (!t.isMemberExpression(node)) return null;
  if (!t.isIdentifier(node.object) || !t.isIdentifier(node.property)) return null;
  return { obj: node.object.name, key: node.property.name };
}

interface SheetEntry {
  propNames: Set<string>;
  raw: string;
}

// StyleSheet.create({...}) 오브젝트에서 key -> 소스 텍스트(속성 이름 집합) 매핑.
function collectStyleSheetKeys(src: string, ast: t.File): Map<string, SheetEntry> {
  const map = new Map<string, SheetEntry>();
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object) &&
        callee.object.name === 'StyleSheet' &&
        t.isIdentifier(callee.property) &&
        callee.property.name === 'create'
      ) {
        const arg = path.node.arguments[0];
        if (!t.isObjectExpression(arg)) return;
        for (const prop of arg.properties) {
          if (!t.isObjectProperty(prop)) continue;
          const keyName = t.isIdentifier(prop.key) ? prop.key.name : null;
          if (!keyName || !t.isObjectExpression(prop.value)) continue;
          const propNames = new Set<string>();
          for (const p of prop.value.properties) {
            if (t.isObjectProperty(p) && t.isIdentifier(p.key)) propNames.add(p.key.name);
          }
          const raw = src.slice(prop.value.start ?? 0, prop.value.end ?? 0);
          map.set(keyName, { propNames, raw });
        }
      }
    },
  });
  return map;
}

interface ResolvedStyle {
  propNames: Set<string>;
  styleKeyNames: string[];
}

// style={...} 표현식(단일/배열/조건)에서 참조하는 모든 StyleSheet 키 이름과, 인라인 ObjectExpression 속성명 수집.
function resolveStyleProps(
  expr: t.Node | null | undefined,
  sheetKeys: Map<string, SheetEntry>,
): ResolvedStyle {
  const propNames = new Set<string>();
  const styleKeyNames: string[] = [];
  function visit(node: t.Node | null | undefined) {
    if (!node) return;
    if (t.isArrayExpression(node)) {
      node.elements.forEach((el) => visit(el));
    } else if (t.isObjectExpression(node)) {
      for (const p of node.properties) {
        if (t.isObjectProperty(p) && t.isIdentifier(p.key)) propNames.add(p.key.name);
      }
    } else if (t.isMemberExpression(node)) {
      const m = memberStyleName(node);
      if (m && m.obj === 'styles') {
        styleKeyNames.push(m.key);
        const found = sheetKeys.get(m.key);
        if (found) found.propNames.forEach((n) => propNames.add(n));
      }
    } else if (t.isConditionalExpression(node)) {
      visit(node.consequent);
      visit(node.alternate);
    } else if (t.isLogicalExpression(node)) {
      visit(node.left);
      visit(node.right);
    }
  }
  visit(expr);
  return { propNames, styleKeyNames };
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

function jsxTagName(el: t.JSXElement): string | null {
  return t.isJSXIdentifier(el.openingElement.name) ? el.openingElement.name.name : null;
}

// 서브트리 안에 실제 문구를 렌더하는 Text 요소가 하나라도 있는지(아이콘 전용/커스텀 컴포넌트 래퍼는 제외).
function hasAnyTextDescendant(path: NodePath<t.JSXElement>): boolean {
  let found = false;
  path.traverse({
    JSXElement(inner) {
      if (jsxTagName(inner.node) !== 'Text') return;
      const hasContent = inner.node.children.some(
        (c) => (t.isJSXText(c) && c.value.trim().length > 0) || t.isJSXExpressionContainer(c),
      );
      if (hasContent) found = true;
    },
  });
  return found;
}

// 텍스트를 렌더하는 JSXElement children 안에서 숫자류 식별자 참조 여부.
function childrenLookNumeric(children: t.JSXElement['children'], src: string): boolean {
  for (const c of children) {
    if (t.isJSXExpressionContainer(c)) {
      const text = src.slice(c.start ?? 0, c.end ?? 0);
      if (NUMERIC_NAME.test(text)) return true;
      if (/[₩%]/.test(text)) return true;
    }
  }
  return false;
}

for (const file of files) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  let ast: t.File;
  try {
    ast = parse(src, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
  } catch {
    continue;
  }
  const sheetKeys = collectStyleSheetKeys(src, ast);

  // 부모 체인 추적을 위해 JSXElement path.parentPath 를 사용.
  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const tagName = jsxTagName(path.node);
      if (!tagName) return;

      const styleAttr = getAttr(opening, 'style');
      const ownStyle =
        styleAttr?.value && t.isJSXExpressionContainer(styleAttr.value)
          ? resolveStyleProps(styleAttr.value.expression, sheetKeys)
          : { propNames: new Set<string>(), styleKeyNames: [] as string[] };

      // ── R-1: numberOfLines={1} Text 3종 세트 ──
      if (tagName === 'Text') {
        const nol = numberOfLinesValue(opening);
        if (nol === 1) {
          const hasEllipsize = !!getAttr(opening, 'ellipsizeMode');
          // 부모(직계 JSXElement) 스타일도 함께 본다.
          let parentStyle: ResolvedStyle = { propNames: new Set<string>(), styleKeyNames: [] };
          let p: NodePath | null = path.parentPath;
          while (p && !t.isJSXElement(p.node)) p = p.parentPath;
          if (p && t.isJSXElement(p.node)) {
            const pStyleAttr = getAttr(p.node.openingElement, 'style');
            if (pStyleAttr?.value && t.isJSXExpressionContainer(pStyleAttr.value)) {
              parentStyle = resolveStyleProps(pStyleAttr.value.expression, sheetKeys);
            }
          }
          const allProps = new Set<string>([...ownStyle.propNames, ...parentStyle.propNames]);
          const hasShrink = allProps.has('flexShrink') || allProps.has('flex');
          const hasMinWidth = allProps.has('minWidth');
          const missing: string[] = [];
          if (!hasEllipsize) missing.push('ellipsizeMode');
          if (!hasShrink) missing.push('flexShrink(또는 flex)');
          if (!hasMinWidth) missing.push('minWidth');
          if (missing.length > 0) {
            violations.push({
              rule: 'R-1',
              file: rel,
              line: lineOf(src, opening.start ?? 0),
              detail: `numberOfLines={1} Text 3종 세트 미비: ${missing.join(', ')} 누락`,
            });
          }
        }

        // ── R-4: 숫자류 콘텐츠에 numberOfLines 사용(adjustsFontSizeToFit로 배율 축소 완화된 경우는 제외) ──
        const hasFitToFit = !!getAttr(opening, 'adjustsFontSizeToFit');
        if (nol !== undefined && !hasFitToFit && childrenLookNumeric(path.node.children, src)) {
          violations.push({
            rule: 'R-4',
            file: rel,
            line: lineOf(src, opening.start ?? 0),
            detail: '숫자/금액/점수류로 추정되는 Text에 numberOfLines 사용 — 숫자는 말줄임 금지, 배율상한/컨테이너 확장으로 해결',
          });
        }
      }

      // ── R-2: 칩/배지류 스타일 ──
      const chipKeyName = ownStyle.styleKeyNames.find((k) => CHIPLIKE_STYLE_NAME.test(k));
      if (chipKeyName) {
        const sheet = sheetKeys.get(chipKeyName);
        if (sheet && sheet.propNames.has('height') && !sheet.propNames.has('minHeight')) {
          violations.push({
            rule: 'R-2',
            file: rel,
            line: lineOf(src, opening.start ?? 0),
            detail: `칩/배지 스타일 '${chipKeyName}' 고정 height 사용 — minHeight로 전환 필요`,
          });
        }
        if (tagName === 'Text' || tagName === 'Chip') {
          if (!getAttr(opening, 'maxFontSizeMultiplier')) {
            violations.push({
              rule: 'R-2',
              file: rel,
              line: lineOf(src, opening.start ?? 0),
              detail: `칩/배지 스타일 '${chipKeyName}' 적용 ${tagName}에 maxFontSizeMultiplier 누락`,
            });
          }
        } else if (hasAnyTextDescendant(path)) {
          // View 등 컨테이너 — 실제 문구 Text가 있는데 캡 있는게 하나도 없으면 위반.
          // (문구 Text가 전혀 없으면 아이콘 전용/커스텀 컴포넌트 래퍼로 보고 스킵 — 교차 파일 과탐 방지.)
          let hasCappedDescendant = false;
          path.traverse({
            JSXElement(inner) {
              const innerTag = jsxTagName(inner.node);
              if (
                (innerTag === 'Text' || innerTag === 'Chip') &&
                getAttr(inner.node.openingElement, 'maxFontSizeMultiplier')
              ) {
                hasCappedDescendant = true;
              }
            },
          });
          if (!hasCappedDescendant) {
            violations.push({
              rule: 'R-2',
              file: rel,
              line: lineOf(src, opening.start ?? 0),
              detail: `칩/배지 스타일 '${chipKeyName}' 컨테이너 하위에 maxFontSizeMultiplier 적용 Text 없음`,
            });
          }
        }
      }

      // ── R-11: 카드 계열 고정 height 후보(전체 — 반복 렌더 문맥이면 표시만 강화) ──
      const cardKeyName = ownStyle.styleKeyNames.find((k) => CARD_STYLE_NAME.test(k));
      if (cardKeyName) {
        const sheet = sheetKeys.get(cardKeyName);
        const repeated = /FlatList|horizontal[=\s]|\.map\(/m.test(src);
        if (sheet && sheet.propNames.has('height') && !sheet.propNames.has('minHeight')) {
          violations.push({
            rule: 'R-11',
            file: rel,
            line: lineOf(src, opening.start ?? 0),
            detail: `카드 스타일 '${cardKeyName}' 고정 height${repeated ? ' + 반복 렌더 문맥(FlatList/map)' : ''} — 균일성/슬롯예약 수동 확인 필요`,
          });
        }
      }
    },
  });
}

// ── DAR-554 검토 완료 허용목록 ──
// 아래 항목은 사람이 확인해 "문장에 숫자가 섞인 설명형 캡션"(독립 숫자 판독 요소가 아님)으로
// 판정한 R-4 후보다. numberOfLines가 문장 전체(라벨+숫자)에 걸려 있고, 숫자만 분리해 보호할
// 카드/칩 UI가 아니라 실제 잘림이 나도 숫자 자체가 아니라 문장 꼬리가 잘린다 — 회귀 감시만 유지.
const ACCEPTED: { file: string; line: number; reason: string }[] = [
  {
    file: 'components/company/EventStudyObservationsDrilldown.tsx',
    line: 129,
    reason: "'표본 {N}건 보기' 액션 라벨 — 숫자가 문장에 인라인, 독립 숫자 판독 요소 아님",
  },
  {
    file: 'components/portfolio/CalibrationSection.tsx',
    line: 202,
    reason: 'confidence 계수 디스카운트 설명문(numberOfLines=2, R-5 캡션 슬롯) — 서술형 문장',
  },
  {
    file: 'components/portfolio/IntradayScalpSection.tsx',
    line: 154,
    reason: '수수료 고지 문장(numberOfLines=2, R-5 캡션 슬롯) — 서술형 문장',
  },
  {
    file: 'app/portfolio/auto-trading.tsx',
    line: 139,
    reason: '주문 타이틀(종목코드·매수/매도·수량 결합 라벨) — 저빈도 화면, 구조 분리 없이 부분 보호 불가',
  },
];

// 아래는 R-1 "3종 세트"가 아니라 R-4 헤드라인 패턴(adjustsFontSizeToFit)으로 동일 문제(잘림)를
// 해결한 의도적 예외 — 형제 요소가 없는 고정폭 컨테이너(5탭 균등폭)라 flexShrink로 양보할
// 이웃이 없다. 스캐너는 이 조합을 인식하지 못해 flexShrink/minWidth 미비로 오탐한다.
const R1_ADJUSTS_FONT_SIZE_EXEMPT: { file: string; line: number; reason: string }[] = [
  {
    file: 'app/(tabs)/_layout.tsx',
    line: 41,
    reason: "탭바 라벨(TabLabel) — adjustsFontSizeToFit+minimumFontScale로 잘림 방지(§5 '포트폴리오' 실측 수정), 형제 없는 고정폭이라 flexShrink 대상 없음",
  },
];
function isR1AdjustsFontSizeExempt(v: Violation): boolean {
  return (
    v.rule === 'R-1' &&
    R1_ADJUSTS_FONT_SIZE_EXEMPT.some((a) => a.file === v.file && a.line === v.line)
  );
}
function isAccepted(v: Violation): boolean {
  return ACCEPTED.some((a) => a.file === v.file && a.line === v.line);
}

// ── 리포트 출력 ──
const byRule: Record<string, Violation[]> = {};
for (const v of violations) {
  (byRule[v.rule] ||= []).push(v);
}
let unacceptedCount = 0;
for (const rule of ['R-1', 'R-2', 'R-4', 'R-11']) {
  const vs = byRule[rule] || [];
  console.log(`\n── ${rule}: ${vs.length}건 ──`);
  for (const v of vs) {
    const accepted = isAccepted(v) || isR1AdjustsFontSizeExempt(v);
    if (!accepted) unacceptedCount++;
    console.log(`  ${accepted ? '[허용]' : '[신규]'} ${v.file}:${v.line}  ${v.detail}`);
  }
}
const allowlistedCount = ACCEPTED.length + R1_ADJUSTS_FONT_SIZE_EXEMPT.length;
console.log(`\n총 ${violations.length}건 (허용목록 ${allowlistedCount}건 제외 시 ${unacceptedCount}건) — 스캔 파일 ${files.length}개`);
if (unacceptedCount > 0) {
  console.error('\nFAIL — 허용목록에 없는 위반이 있습니다.');
  process.exit(1);
}
console.log('\nALL PASS — 신규 위반 없음(허용목록만 잔존).');
