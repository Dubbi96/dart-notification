import { PrismaClient, Disclosure } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

/**
 * 테스트용 알림 데이터 시드
 * - 현재 DB에 있는 유저, 공시 데이터를 기반으로 알림 생성
 * - 관심기업의 공시가 있으면 해당 공시로, 없으면 최근 공시로 생성
 */
async function main() {
  console.log('=== 테스트 알림 시드 시작 ===\n');

  // 1. 유저 조회
  const users = await prisma.user.findMany({
    include: {
      watchLists: {
        include: { company: true },
      },
    },
  });

  if (users.length === 0) {
    console.log('❌ 등록된 유저가 없습니다. 먼저 회원가입 해주세요.');
    return;
  }

  console.log(`유저 ${users.length}명 발견\n`);

  let totalCreated = 0;

  for (const user of users) {
    console.log(`\n👤 ${user.name || user.email} (${user.id})`);

    // 2. 관심기업의 공시 조회
    const watchCorpCodes = user.watchLists.map((w) => w.corpCode);
    let disclosures: Disclosure[] = [];

    if (watchCorpCodes.length > 0) {
      disclosures = await prisma.disclosure.findMany({
        where: { corpCode: { in: watchCorpCodes } },
        orderBy: { rcpDt: 'desc' },
        take: 20,
      });
      console.log(
        `  관심기업 ${watchCorpCodes.length}개 → 공시 ${disclosures.length}개 발견`,
      );
    }

    // 관심기업 공시가 없으면 최근 공시에서 가져오기
    if (disclosures.length === 0) {
      disclosures = await prisma.disclosure.findMany({
        orderBy: { rcpDt: 'desc' },
        take: 15,
      });
      console.log(
        `  관심기업 공시 없음 → 최근 공시 ${disclosures.length}개 사용`,
      );
    }

    if (disclosures.length === 0) {
      console.log('  ❌ DB에 공시 데이터가 없습니다. 스케줄러를 먼저 실행해주세요.');
      continue;
    }

    // 3. 알림 생성 (일부는 읽음, 일부는 안읽음)
    let created = 0;
    for (let i = 0; i < disclosures.length; i++) {
      const disclosure = disclosures[i];
      const isRead = i >= 10; // 처음 10개는 안읽음, 나머지는 읽음

      // sentAt을 최근 시간으로 분산 (최신순)
      const sentAt = new Date();
      sentAt.setMinutes(sentAt.getMinutes() - i * 30); // 30분 간격으로 분산

      try {
        await prisma.notificationHistory.upsert({
          where: {
            userId_disclosureRcpNo: {
              userId: user.id,
              disclosureRcpNo: disclosure.rcpNo,
            },
          },
          update: {}, // 이미 있으면 건너뛰기
          create: {
            userId: user.id,
            disclosureRcpNo: disclosure.rcpNo,
            sentAt,
            isRead,
            readAt: isRead ? new Date() : null,
          },
        });
        created++;
      } catch (e) {
        // FK 제약 등으로 실패 시 건너뛰기
        console.log(`  ⚠️ 건너뜀: ${disclosure.rcpNo} - ${e.message}`);
      }
    }

    totalCreated += created;
    console.log(`  ✅ 알림 ${created}개 생성 (읽지않음: ${Math.min(created, 10)}개)`);
  }

  console.log(`\n=== 시드 완료: 총 ${totalCreated}개 알림 생성 ===`);

  // 확인
  const total = await prisma.notificationHistory.count();
  const unread = await prisma.notificationHistory.count({
    where: { isRead: false },
  });
  console.log(`DB 현황: 전체 ${total}개 / 읽지않음 ${unread}개`);
}

main()
  .catch((e) => {
    console.error('시드 실패:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
