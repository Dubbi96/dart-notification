import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ApiErrorState } from '@components/common/StateView';
import { EditionDateStrip } from '@components/signals/EditionDateStrip';
import { EditionOptInBanner } from '@components/signals/EditionOptInBanner';
import { EditionSignalList } from '@components/signals/EditionSignalList';
import { useDailyEditions } from '@hooks/useSignals';
import { useNotificationSettings } from '@hooks/useNotificationSettings';
import { useEditionReadStore, isEditionUnread } from '@stores/editionReadStore';
import { recordTesterEvent } from '@services/testerEvents.service';

import type { TradingSignal } from '@app-types/signal.types';

// 매수 뷰 에디션 브라우징 컨테이너(DAR-509, 정본 §3·§4-S5) — 날짜 스트립(고정) + 선택일 세로 리스트.
// 이 컴포넌트는 매수 탭 · 에디션 모드 · 인증 상태에서만 마운트돼(부모 조건부 렌더) useDailyEditions
// 조회를 게이팅한다(게스트 401 소음·매도/아카이브 불필요 fetch 회피). 스트립은 세로 리스트 '밖'에
// 고정 배치돼 제스처 축을 분리한다(가로 스트립 ↔ 세로 리스트 충돌·Fabric 백지 회귀 방지).

interface BuyEditionViewProps {
  /** 탭 재탭 시 최상단 복귀용 공유 ref(부모 화면이 useScrollToTop 배선). */
  listRef?: React.RefObject<FlatList<TradingSignal> | null>;
  /**
   * DAR-527: 에디션 발행 딥링크(`/signals?date=YYYYMMDD`)로 진입 시 열 '해당 호' 날짜.
   * 지정되면 초기 선택일로 시드하고, 이미 마운트된 탭에 새 값이 도착하면 그 호로 전환한다.
   */
  focusDate?: string;
}

function BuyEditionViewBase({ listRef, focusDate }: BuyEditionViewProps) {
  const editionsQuery = useDailyEditions();
  const queryClient = useQueryClient();

  // 참조 안정화(useMemo unreadDates 의 deps 안정 — 매 렌더 새 [] 방지). data.items 불변 시 동일 참조.
  const editions = useMemo(() => editionsQuery.data?.items ?? [], [editionsQuery.data?.items]);
  const meta = editionsQuery.data?.meta;
  const todayDate = meta?.todayDate;

  // 선택 에디션 — 사용자가 명시 선택하기 전엔 기본값 = 최신 에디션(없으면 오늘 → COLD_START 빈 상태).
  // useEffect+setState 동기화 대신 렌더 중 폴백 표현식으로 파생해 캐스케이드 렌더/effect 를 없앤다.
  // (meta 로드 전엔 undefined → EditionSignalList 스켈레톤. 로드 후 최신일로 자연 확정.)
  // DAR-527: 딥링크 focusDate 가 있으면 초기 선택일로 시드한다(해당 호 직행).
  const [userSelectedDate, setUserSelectedDate] = useState<string | undefined>(focusDate);
  const selectedDate = userSelectedDate ?? meta?.latestDate ?? meta?.todayDate;

  // DAR-527: 딥링크로 새 focusDate 가 도착하면(이미 마운트된 탭에 다른 호 푸시 탭) 해당 호로 전환.
  //   렌더 단계 derive-from-props(포트폴리오 `?tab=` 동일 사상) — useEffect+setState 커밋 회피.
  const [seenFocusDate, setSeenFocusDate] = useState(focusDate);
  if (focusDate !== seenFocusDate) {
    setSeenFocusDate(focusDate);
    if (focusDate) setUserSelectedDate(focusDate);
  }

  // DAR-527: '놓친 호' 열람 기록(클라이언트 로컬). 알림 '에디션 계열'(editionPushEnabled)이 켜졌을
  //   때만 뱃지를 노출한다 — 계열 OFF(기본값) 시엔 푸시도 뱃지도 조용(단일 토글 정합).
  const readDates = useEditionReadStore((s) => s.readDates);
  const baselineDate = useEditionReadStore((s) => s.baselineDate);
  const markRead = useEditionReadStore((s) => s.markRead);
  const setBaseline = useEditionReadStore((s) => s.setBaseline);
  // 인증 상태(부모가 이미 게이팅)에서만 마운트되므로 설정 조회는 안전. 로드 전엔 undefined→미노출.
  const { data: notifSettings } = useNotificationSettings();
  const editionBadgeEnabled = notifSettings?.editionPushEnabled === true;

  // 최초 에디션 관측 시 기준선 시드(설치 직후 과거 백카탈로그 일괄 뱃지 방지). setBaseline 은 최초 1회만.
  useEffect(() => {
    if (meta?.latestDate) setBaseline(meta.latestDate);
  }, [meta?.latestDate, setBaseline]);

  // DAR-516 계측 + DAR-527 열람 처리: 확정된 거래일이 표시될 때마다 발화 — deps=selectedDate 이므로
  // 서로 다른 날짜당 1회(최초 확정 + 날짜 전환)만 기록된다. 실패는 서비스가 흡수(fire-and-forget).
  useEffect(() => {
    if (selectedDate) {
      void recordTesterEvent('edition_open');
      markRead(selectedDate); // 열람 → '놓친 호' 뱃지 해제.
    }
  }, [selectedDate, markRead]);

  // '놓친 호' 날짜 집합 — 계열 ON & 매수건 있는 호 & (기준선 초과·미열람)만. 계열 OFF 면 빈 집합.
  const unreadDates = useMemo(() => {
    const set = new Set<string>();
    if (!editionBadgeEnabled) return set;
    for (const e of editions) {
      if (e.count > 0 && isEditionUnread(e.date, { readDates, baselineDate })) set.add(e.date);
    }
    return set;
  }, [editions, editionBadgeEnabled, readDates, baselineDate]);

  // pull-to-refresh(리스트) 시 날짜 목록(스트립)도 함께 갱신.
  const refreshEditions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['signals', 'daily-editions'] });
  }, [queryClient]);

  // 날짜 목록 자체 조회 실패(데이터 없음) → 스트립을 못 그리므로 화면 단위 에러 + 재시도.
  if (editionsQuery.isError && !editionsQuery.data) {
    return (
      <ApiErrorState
        error={editionsQuery.error}
        title="에디션 목록을 불러오지 못했습니다."
        description="잠시 후 다시 시도해 주세요."
        onRetry={editionsQuery.refetch}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* DAR-547: 에디션 뷰 상단 옵트인 배너(에디션 푸시 발견성). 이미 ON·dismiss 시 스스로 미노출. */}
      <EditionOptInBanner />
      {/* 판단 존재일이 있거나 오늘 진입점이 있으면 스트립 노출(로딩 중엔 미노출 → 리스트 스켈레톤). */}
      {editions.length > 0 || todayDate ? (
        <EditionDateStrip
          editions={editions}
          todayDate={todayDate}
          selectedDate={selectedDate}
          onSelect={setUserSelectedDate}
          unreadDates={unreadDates}
        />
      ) : null}
      <EditionSignalList
        date={selectedDate}
        todayDate={todayDate}
        onSelectDate={setUserSelectedDate}
        onRefreshEditions={refreshEditions}
        listRef={listRef}
      />
    </View>
  );
}

export const BuyEditionView = React.memo(BuyEditionViewBase);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
