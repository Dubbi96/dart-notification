// backend/src/disclosure-documents/parsers/table.parser.spec.ts
import { parseTables } from './table.parser';

describe('parseTables', () => {
  it('기본 table 구조에서 headers와 rows를 추출해야 한다', () => {
    const html = `
      <table>
        <tr><th>항목</th><th>금액</th></tr>
        <tr><td>계약금액</td><td>120,000,000,000원</td></tr>
        <tr><td>최근 매출액</td><td>500,000,000,000원</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(['항목', '금액']);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0]).toEqual(['계약금액', '120,000,000,000원']);
  });

  it('TH 태그로 헤더를 감지해야 한다 (T-03 규칙 1)', () => {
    const html = `
      <table>
        <tr><th>이름</th><th>값</th></tr>
        <tr><td>A</td><td>100</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    expect(tables[0].headers).toEqual(['이름', '값']);
    expect(tables[0].rows).toHaveLength(1);
  });

  it('TH 없는 경우 첫 행 조건으로 헤더를 감지해야 한다 (T-03 규칙 2a)', () => {
    const html = `
      <table>
        <tr><td>항목명</td><td>수량</td><td>비고</td></tr>
        <tr><td>계약금액</td><td>1000</td><td>부가세포함</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    // 첫 행 셀 길이 20자 이하 → 헤더로 감지
    expect(tables[0].headers).toEqual(['항목명', '수량', '비고']);
    expect(tables[0].rows).toHaveLength(1);
  });

  it('빈 테이블을 결과에서 제외해야 한다 (T-02)', () => {
    const html = `
      <table>
        <tr><td></td><td></td></tr>
      </table>
      <table>
        <tr><td>실제데이터</td><td>값</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows[0][0]).toBe('실제데이터');
  });

  it('caption을 추출해야 한다', () => {
    const html = `
      <table>
        <caption>계약 내역</caption>
        <tr><th>항목</th><th>금액</th></tr>
        <tr><td>계약금액</td><td>100억원</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    expect(tables[0].caption).toBe('계약 내역');
  });

  it('colspan을 감지하고 hasColspan 플래그를 세워야 한다 (T-04)', () => {
    const html = `
      <table>
        <tr><td colspan="2">병합셀</td></tr>
        <tr><td>A</td><td>B</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    expect(tables[0].hasColspan).toBe(true);
  });

  it('rowspan을 감지하고 hasRowspan 플래그를 세워야 한다 (T-05)', () => {
    const html = `
      <table>
        <tr><td rowspan="2">병합행</td><td>A</td></tr>
        <tr><td>B</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    expect(tables[0].hasRowspan).toBe(true);
  });

  it('단위 행을 unitNote 필드에 저장해야 한다 (T-06)', () => {
    const html = `
      <table>
        <tr><td colspan="3">단위: 원</td></tr>
        <tr><th>항목</th><th>금액</th><th>비고</th></tr>
        <tr><td>계약금액</td><td>120000000000</td><td>-</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    expect(tables[0].unitNote).toMatch(/단위/);
  });

  it('셀 내 &nbsp; 엔터티를 정규화해야 한다 (T-07)', () => {
    const html = `
      <table>
        <tr><td>항목&nbsp;명</td><td>금&amp;액</td></tr>
        <tr><td>계약금액</td><td>100</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    // headers는 TH 없으므로 첫 행이 헤더가 될 수 있음
    const allText = [...tables[0].headers, ...tables[0].rows.flat()].join(' ');
    expect(allText).not.toContain('&nbsp;');
    expect(allText).not.toContain('&amp;');
    expect(allText).toContain('금&액');
  });

  it('<br> 태그를 줄바꿈으로 변환해야 한다 (T-07)', () => {
    const html = `
      <table>
        <tr><th>항목</th><th>내용</th></tr>
        <tr><td>주소</td><td>서울특별시<br>강남구</td></tr>
      </table>
    `;
    const tables = parseTables(html);
    expect(tables[0].rows[0][1]).toContain('\n');
  });

  it('대소문자 혼재 TABLE 태그를 파싱해야 한다', () => {
    const html = `
      <TABLE>
        <TR><TH>항목</TH><TH>값</TH></TR>
        <TR><TD>금액</TD><TD>100</TD></TR>
      </TABLE>
    `;
    const tables = parseTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(['항목', '값']);
  });

  it('복수의 table을 올바른 tableIndex로 반환해야 한다', () => {
    const html = `
      <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
      <table><tr><th>B</th></tr><tr><td>2</td></tr></table>
    `;
    const tables = parseTables(html);
    expect(tables).toHaveLength(2);
    expect(tables[0].tableIndex).toBe(0);
    expect(tables[1].tableIndex).toBe(1);
  });

  it('테이블이 없는 HTML에서 빈 배열을 반환해야 한다', () => {
    const html = '<div><p>테이블 없음</p></div>';
    const tables = parseTables(html);
    expect(tables).toHaveLength(0);
  });
});
