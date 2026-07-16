import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DAR-516 [Wave A/cross·P1] — 테스터 코호트 인앱 행동 이벤트 화이트리스트(TesterEvent.event 허용값).
 *
 * 계측 5지점 + iOS 게이트 설문 3응답. 모바일 `utils/testerEvents.ts` 의 TESTER_EVENTS 와
 * 정확히 일치해야 한다(계측 SSOT 미러 — 값 추가/변경 시 양쪽 동시 갱신).
 *
 * ★ PII 무수집(수용기준 1): 이벤트명은 고정 화이트리스트뿐 — 종목/카드 식별자·자유텍스트를
 *   이벤트명에 실어 보낼 수 없다. 서버는 userId(인증)·event·ts(서버 스탬프)만 적재한다.
 */
export const TESTER_EVENTS = [
  'edition_open', // 에디션 오픈(신호탭 날짜 선택 / 홈 최신 에디션 요약 노출)
  'card_tap', // 신호·에디션 카드 탭(상세 진입)
  'push_open', // 푸시 알림 탭으로 앱 진입
  'stats_section_view', // '과거 유사공시 반응' 등 통계 섹션 노출
  'waitlist_cta', // Pro waitlist(대기자) CTA 탭
  'survey_ios_shown', // iOS 게이트 설문 노출
  'survey_ios_answer_yes', // iOS 설문 응답: 관심 있음
  'survey_ios_answer_no', // iOS 설문 응답: 나중에/관심 없음
] as const;

export type TesterEventName = (typeof TESTER_EVENTS)[number];

export class RecordTesterEventDto {
  @ApiProperty({
    description: '테스터 코호트 인앱 행동 이벤트(고정 화이트리스트)',
    enum: TESTER_EVENTS,
    example: 'edition_open',
  })
  @IsIn(TESTER_EVENTS)
  event: TesterEventName;
}
