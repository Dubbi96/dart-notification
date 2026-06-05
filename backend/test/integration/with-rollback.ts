/**
 * with-rollback.ts — 통합테스트 격리 유틸 (DAR-38)
 *
 * Engine4/5 Prisma 어댑터를 **실 Postgres**(dev DB)로 검증하되, dev DB는 데모 backend가
 * 동시에 쓰는 동일 DB이므로 단 1 row도 커밋되어서는 안 된다.
 *
 * 전략: 인터랙티브 트랜잭션(`prisma.$transaction(async (tx) => ...)`) 안에서 FK 부모 row를
 * 만들고, 리포지토리(생성자에 tx 주입)로 save→find 왕복을 수행해 결과를 캡처한 뒤,
 * 콜백 끝에서 ROLLBACK 센티넬을 throw 해 **전부 롤백**한다. 캡처값만 호출자에게 반환되어
 * assert는 롤백 이후(영구 커넥션 기준 잔여 0)에 실 DB 왕복 데이터로 수행된다.
 *
 * AI 금지영역: 이 유틸은 트랜잭션 제어만 담당. 점수·트리거 로직 없음(AI 개입 0).
 */

import { Prisma, PrismaClient } from '@prisma/client';

/** 정상 흐름과 구분되는 롤백 전용 센티넬 (에러 메시지/스택 비교 없이 참조 동일성으로 식별) */
const ROLLBACK = Symbol('dar38-integration-rollback');

/**
 * `work`를 항상 롤백되는 인터랙티브 트랜잭션 안에서 실행한다.
 * `work`는 트랜잭션 클라이언트(tx)를 받아 FK 부모 생성 + 리포지토리 왕복을 수행하고,
 * 반환한 값이 롤백 이후 호출자에게 그대로 전달된다.
 */
export async function withRollback<T>(
  prisma: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let captured: T | undefined;
  try {
    await prisma.$transaction(
      async (tx) => {
        captured = await work(tx);
        // 캡처 완료 후 의도적 롤백 — 커밋 0, 잔여 row 0 보장
        throw ROLLBACK;
      },
      { timeout: 20000 },
    );
  } catch (e) {
    if (e !== ROLLBACK) throw e; // 진짜 에러(쿼리 실패·assert 등)는 전파
  }
  return captured as T;
}
