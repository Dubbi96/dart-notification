// backend/src/disclosure-documents/parsers/xml.parser.ts
// DART document.xml 파싱 — fast-xml-parser 사용

import { XMLParser } from 'fast-xml-parser';
import { cleanHtml } from './html-cleaner';

/**
 * DART document.xml을 파싱해 각 SECTION의 텍스트 내용 배열을 반환한다.
 *
 * document.xml 구조 예:
 *   <ROOT>
 *     <SECTION-1><TITLE>...</TITLE><BODY>...</BODY></SECTION-1>
 *     <SECTION-2>...</SECTION-2>
 *   </ROOT>
 *
 * SECTION 태그명 패턴: SECTION-\d+ (예: SECTION-1, SECTION-2)
 *
 * 파싱 실패 시 빈 배열 반환 (throw하지 않음)
 */
export function parseXmlSections(xml: string): string[] {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      trimValues: true,
      allowBooleanAttributes: true,
      // 텍스트 내용을 #text 키로 보존
      textNodeName: '#text',
    });

    const parsed = parser.parse(xml);

    // ROOT 또는 최상위 루트 탐색
    const root: Record<string, unknown> =
      (parsed['ROOT'] as Record<string, unknown>) ??
      (parsed as Record<string, unknown>);

    const sections: string[] = [];

    // SECTION-N 패턴 키 탐색
    for (const key of Object.keys(root)) {
      if (/^SECTION-\d+$/i.test(key)) {
        const sectionContent = extractTextFromNode(root[key]);
        if (sectionContent.trim()) {
          sections.push(sectionContent.trim());
        }
      }
    }

    // SECTION 키가 없으면 전체 루트에서 텍스트 추출
    if (sections.length === 0) {
      const fallbackText = extractTextFromNode(root);
      if (fallbackText.trim()) {
        sections.push(fallbackText.trim());
      }
    }

    return sections;
  } catch {
    // fast-xml-parser 실패 시 정규식 fallback
    return parseXmlSectionsFallback(xml);
  }
}

/**
 * fast-xml-parser 실패 시 정규식 기반 SECTION 추출 fallback
 */
function parseXmlSectionsFallback(xml: string): string[] {
  const sectionPattern = /<SECTION-\d+[\s\S]*?<\/SECTION-\d+>/gi;
  const matches = xml.match(sectionPattern) ?? [];

  if (matches.length === 0) {
    // 전체 XML에서 태그 제거해 텍스트 반환
    return [cleanHtml(xml)];
  }

  return matches.map((m) => cleanHtml(m)).filter((t) => t.trim().length > 0);
}

/**
 * 파싱된 XML 노드에서 재귀적으로 텍스트 내용을 추출한다.
 */
function extractTextFromNode(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node === null || node === undefined) return '';

  if (Array.isArray(node)) {
    return node.map((item) => extractTextFromNode(item)).join(' ');
  }

  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const parts: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      // 속성 키(@로 시작) 제외
      if (key.startsWith('@')) continue;
      parts.push(extractTextFromNode(value));
    }

    return parts.join(' ');
  }

  return '';
}
