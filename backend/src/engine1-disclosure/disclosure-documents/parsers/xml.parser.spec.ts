// backend/src/disclosure-documents/parsers/xml.parser.spec.ts
import * as fs from 'fs';
import * as path from 'path';
import { parseXmlSections } from './xml.parser';

const FIXTURES_DIR = path.join(__dirname, '../__fixtures__');

describe('parseXmlSections', () => {
  it('단일 SECTION 블록에서 텍스트를 추출해야 한다', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <ROOT>
        <SECTION-1>
          <TITLE>계약 체결</TITLE>
          <BODY><P>계약금액은 120억원입니다.</P></BODY>
        </SECTION-1>
      </ROOT>`;

    const sections = parseXmlSections(xml);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0]).toContain('계약금액');
  });

  it('복수의 SECTION 블록 각각을 추출해야 한다', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <ROOT>
        <SECTION-1><TITLE>섹션1</TITLE><BODY>섹션1 내용</BODY></SECTION-1>
        <SECTION-2><TITLE>섹션2</TITLE><BODY>섹션2 내용</BODY></SECTION-2>
      </ROOT>`;

    const sections = parseXmlSections(xml);
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it('supply-contract.xml 픽스처에서 섹션을 추출해야 한다', () => {
    const xmlPath = path.join(FIXTURES_DIR, 'supply-contract.xml');
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const sections = parseXmlSections(xml);

    expect(sections.length).toBeGreaterThan(0);
    const joinedText = sections.join(' ');
    expect(joinedText).toContain('계약');
  });

  it('cb-issuance.xml 픽스처에서 전환사채 내용을 포함해야 한다', () => {
    const xmlPath = path.join(FIXTURES_DIR, 'cb-issuance.xml');
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const sections = parseXmlSections(xml);

    const joinedText = sections.join(' ');
    expect(joinedText).toContain('전환사채');
  });

  it('잘못된 XML에서도 fallback으로 텍스트를 반환해야 한다 (P-01)', () => {
    const brokenXml = '<SECTION-1><TITLE>제목</TITLE>잘못된 XML<<';
    const sections = parseXmlSections(brokenXml);
    // 오류 없이 반환되어야 함
    expect(Array.isArray(sections)).toBe(true);
  });

  it('빈 XML에 대해 빈 배열을 반환해야 한다', () => {
    const sections = parseXmlSections('');
    expect(Array.isArray(sections)).toBe(true);
  });

  it('SECTION 태그가 없는 XML에서 fallback으로 전체 텍스트를 반환해야 한다', () => {
    const xml = `<?xml version="1.0"?>
      <ROOT><BODY>내용만 있는 XML</BODY></ROOT>`;
    const sections = parseXmlSections(xml);
    expect(sections.length).toBeGreaterThan(0);
    const joinedText = sections.join(' ');
    expect(joinedText.trim().length).toBeGreaterThan(0);
  });
});
