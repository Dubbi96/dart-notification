import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

interface CorpCodeItem {
  corp_code: string;
  corp_name: string;
  stock_code: string | number | null;
  modify_date: string;
}

/**
 * DART API에서 기업 고유번호 ZIP 파일 다운로드 후 XML 파싱
 */
async function fetchCorpCodes(): Promise<CorpCodeItem[]> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey || apiKey === 'your-dart-api-key') {
    throw new Error('DART_API_KEY가 .env에 설정되지 않았습니다.');
  }

  console.log('DART API에서 기업 목록 다운로드 중...');
  const response = await axios.get(
    'https://opendart.fss.or.kr/api/corpCode.xml',
    {
      params: { crtfc_key: apiKey },
      responseType: 'arraybuffer',
      timeout: 30000,
    },
  );

  // ZIP 해제
  const zip = new AdmZip(Buffer.from(response.data));
  const entries = zip.getEntries();
  const xmlEntry = entries.find((e) => e.entryName.endsWith('.xml'));
  if (!xmlEntry) {
    throw new Error('ZIP 파일에 XML이 없습니다.');
  }

  const xmlContent = xmlEntry.getData().toString('utf-8');
  console.log('XML 파싱 중...');

  // XML 파싱
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name) => name === 'list',
  });
  const parsed = parser.parse(xmlContent);
  const items: CorpCodeItem[] = parsed.result.list;

  console.log(`총 ${items.length}개 기업 데이터 파싱 완료`);
  return items;
}

/**
 * 종목코드로 시장 구분 (간이 분류)
 * 실제로는 DART API만으로는 시장 구분이 어려우므로, 종목코드 유무로만 구분
 */
function classifyMarket(stockCode: string | null): string | null {
  if (!stockCode) return null;
  // 종목코드가 있으면 상장사 (KOSPI/KOSDAQ 구분은 별도 데이터 필요)
  return 'LISTED';
}

async function main() {
  console.log('=== DART 기업 마스터 데이터 시드 시작 ===\n');

  const items = await fetchCorpCodes();

  // stockCode가 빈 문자열이거나 0인 경우 null 처리
  const companies = items.map((item) => {
    const stockCode =
      item.stock_code && String(item.stock_code).trim() !== ''
        ? String(item.stock_code).padStart(6, '0')
        : null;

    return {
      corpCode: String(item.corp_code).padStart(8, '0'),
      corpName: String(item.corp_name),
      stockCode,
      market: classifyMarket(stockCode),
    };
  });

  // 상장사 수 확인
  const listedCount = companies.filter((c) => c.stockCode).length;
  console.log(`상장사: ${listedCount}개 / 전체: ${companies.length}개\n`);

  // 배치 upsert (500개씩)
  const BATCH_SIZE = 500;
  let processed = 0;

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);

    await prisma.$transaction(
      batch.map((company) =>
        prisma.company.upsert({
          where: { corpCode: company.corpCode },
          update: {
            corpName: company.corpName,
            stockCode: company.stockCode,
            market: company.market,
          },
          create: company,
        }),
      ),
    );

    processed += batch.length;
    const pct = ((processed / companies.length) * 100).toFixed(1);
    process.stdout.write(`\r진행: ${processed}/${companies.length} (${pct}%)`);
  }

  console.log('\n\n=== 시드 완료 ===');

  // 확인
  const total = await prisma.company.count();
  const listed = await prisma.company.count({
    where: { stockCode: { not: null } },
  });
  console.log(`DB 저장: 전체 ${total}개 / 상장사 ${listed}개`);
}

main()
  .catch((e) => {
    console.error('시드 실패:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
