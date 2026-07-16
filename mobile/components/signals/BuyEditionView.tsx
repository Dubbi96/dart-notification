import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ApiErrorState } from '@components/common/StateView';
import { EditionDateStrip } from '@components/signals/EditionDateStrip';
import { EditionSignalList } from '@components/signals/EditionSignalList';
import { useDailyEditions } from '@hooks/useSignals';
import { recordTesterEvent } from '@services/testerEvents.service';

import type { TradingSignal } from '@app-types/signal.types';

// 매수 뷰 에디션 브라우징 컨테이너(DAR-509, 정본 §3·§4-S5) — 날짜 스트립(고정) + 선택일 세로 리스트.
// 이 컴포넌트는 매수 탭 · 에디션 모드 · 인증 상태에서만 마운트돼(부모 조건부 렌더) useDailyEditions
// 조회를 게이팅한다(게스트 401 소음·매도/아카이브 불필요 fetch 회피). 스트립은 세로 리스트 '밖'에
// 고정 배치돼 제스처 축을 분리한다(가로 스트립 ↔ 세로 리스트 충돌·Fabric 백지 회귀 방지).

interface BuyEditionViewProps {
  /** 탭 재탭 시 최상단 복귀용 공유 ref(부모 화면이 useScrollToTop 배선). */
  listRef?: React.RefObject<FlatList<TradingSignal> | null>;
}

function BuyEditionViewBase({ listRef }: BuyEditionViewProps) {
  const editionsQuery = useDailyEditions();
  const queryClient = useQueryClient();

  const editions = editionsQuery.data?.items ?? [];
  const meta = editionsQuery.data?.meta;
  const todayDate = meta?.todayDate;

  // 선택 에디션 — 사용자가 명시 선택하기 전엔 기본값 = 최신 에디션(없으면 오늘 → COLD_START 빈 상태).
  // useEffect+setState 동기화 대신 렌더 중 폴백 표현식으로 파생해 캐스케이드 렌더/effect 를 없앤다.
  // (meta 로드 전엔 undefined → EditionSignalList 스켈레톤. 로드 후 최신일로 자연 확정.)
  const [userSelectedDate, setUserSelectedDate] = useState<string | undefined>(undefined);
  const selectedDate = userSelectedDate ?? meta?.latestDate ?? meta?.todayDate;

  // DAR-516 계측: 에디션 오픈(신호탭). 확정된 거래일이 표시될 때마다 발화 — deps=selectedDate 이므로
  // 서로 다른 날짜당 1회(최초 확정 + 날짜 전환)만 기록된다. 실패는 서비스가 흡수(fire-and-forget).
  useEffect(() => {
    if (selectedDate) void recordTesterEvent('edition_open');
  }, [selectedDate]);

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
      {/* 판단 존재일이 있거나 오늘 진입점이 있으면 스트립 노출(로딩 중엔 미노출 → 리스트 스켈레톤). */}
      {editions.length > 0 || todayDate ? (
        <EditionDateStrip
          editions={editions}
          todayDate={todayDate}
          selectedDate={selectedDate}
          onSelect={setUserSelectedDate}
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
