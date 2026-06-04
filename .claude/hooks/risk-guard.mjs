#!/usr/bin/env node
/**
 * PreToolUse 가드 (Edit/Write/MultiEdit) — 비전 SSOT 의 "AI 금지영역"을 코드 편집 단계에서 강제한다.
 *
 * 비전 원칙 (docs/roadmap/00-vision-and-principles.md, cc-engine-architecture.md §4-6):
 *   - Engine 5 RiskCheckService 는 AiAnalystModule/AI 에 의존성을 가질 수 없다 (독립 실행).
 *   - 최종 주문 승인 / 손절·익절 하드룰 / 포트폴리오 한도 / 주문 수량 / 리스크 우회
 *     경로에 AI 호출이 들어가면 안 된다.
 *
 * 좁게(=명백한 위반만) 차단해 오탐을 최소화한다. 가동 후 실제 위반 패턴을 보며 정밀화한다.
 */
import { readFileSync } from 'node:fs';

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const ti = input?.tool_input ?? {};
const fp = ti.file_path ?? '';
// Edit=new_string, Write=content, MultiEdit=edits[].new_string
const content = [
  ti.new_string ?? '',
  ti.content ?? '',
  ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string ?? '') : []),
].join('\n');

// Engine 5 (Risk / Trading) 경로의 파일인가?
const isRiskPath = /(risk[-.]?check|trading[-.]?risk|engine5|order\.service|execution\.service)/i.test(fp);

if (isRiskPath) {
  const importsAi =
    /import[^\n]*\b(AiAnalyst|ai[-.]?analyst|AiAnalystService|AiAnalystModule|PersonaAnalysis|ai[-.]?cost[-.]?gate)\b/i.test(
      content,
    );
  if (importsAi) {
    block(
      `${fp} (Engine5 Risk/Trading 경로)가 AI 모듈을 import 하려 합니다.\n` +
        '   Risk Engine 은 AI 에 의존성을 가질 수 없습니다 (비전 SSOT: 독립 실행 강제).',
    );
  }

  // 주문 승인/수량/한도 경로에 AI 호출이 섞이는 경우
  const aiCallInOrder =
    /(approveOrder|proposeOrder|checkPreOrderRisk|orderQuantity|positionLimit)[\s\S]{0,200}\b(aiAnalyst|llm|openai|claude|callAi|runSummary|runThesis)\b/i.test(
      content,
    );
  if (aiCallInOrder) {
    block(
      `${fp} 의 주문/리스크 결정 경로에 AI 호출 흔적이 감지되었습니다.\n` +
        '   최종 주문 승인·수량·한도·리스크 우회는 AI 절대 금지영역입니다.',
    );
  }
}

process.exit(0);

function block(msg) {
  process.stderr.write(`⚠️ AI 금지영역 가드: ${msg}\n`);
  process.exit(2);
}
