/**
 * Persona P-B 철학 적합도 데모 스크립트 (DAR-53).
 *
 * 실행: npx ts-node -r dotenv/config src/engine2-ai-analyst/philosophy/philosophy-fit.manual.ts [philosophyId]
 *   예: npx ts-node -r dotenv/config src/engine2-ai-analyst/philosophy/philosophy-fit.manual.ts BUFFETT
 *
 * DB 의 CompanyFinancial 보유 종목 전체에 대해 on-demand 철학 적합도를 산출한다.
 * 실제 PhilosophyFitService(=조회 경로와 동일) 를 부트스트랩해 사용 — 영속화 없음(읽기 전용).
 * AI 미개입 — 순수 Rule.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PhilosophyFitService } from './philosophy-fit.service';

async function main(): Promise<void> {
  const logger = new Logger('PhilosophyFitManual');
  const philosophyId = process.argv[2] || 'BUFFETT';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const fit = app.get(PhilosophyFitService);

    // CompanyFinancial 보유 종목(고유 corpCode) 수집
    const rows = await prisma.companyFinancial.findMany({
      select: { corpCode: true },
      distinct: ['corpCode'],
    });
    const corpCodes = rows.map((r) => r.corpCode);
    console.log(`CompanyFinancial 보유 종목 수: ${corpCodes.length}`);

    const results: Array<{
      corpCode: string;
      score: number | null;
      passed: number;
      evaluated: number;
      passedKeys: string;
    }> = [];

    for (const corpCode of corpCodes) {
      const r = await fit.getPhilosophyFit(philosophyId, corpCode);
      results.push({
        corpCode,
        score: r.fit?.score ?? null,
        passed: r.fit?.passedMetricKeys.length ?? 0,
        evaluated: r.fit?.evaluatedCount ?? 0,
        passedKeys: r.fit?.passedMetricKeys.join(',') ?? '-',
      });
    }

    // 점수 내림차순 정렬 후 출력
    results.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    console.log(`\n=== ${philosophyId} 철학 적합도 (점수 내림차순) ===`);
    for (const r of results) {
      console.log(
        `${r.corpCode}  score=${r.score == null ? 'N/A' : r.score.toFixed(2).padStart(6)}  ` +
          `통과 ${r.passed}/${r.evaluated}  [${r.passedKeys}]`,
      );
    }

    const computable = results.filter((r) => r.score != null);
    // "버핏 기준 통과 종목" = 전 평가지표 통과(미달 0) 종목
    const fullPass = computable.filter((r) => r.passed === r.evaluated && r.evaluated > 0);
    console.log(
      `\n요약: 평가가능 ${computable.length}/${corpCodes.length}종목, ` +
        `${philosophyId} 전지표 통과 ${fullPass.length}종목: ` +
        `${fullPass.map((r) => r.corpCode).join(', ') || '없음'}`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[PhilosophyFitManual] 실패:', err);
    process.exit(1);
  });
