import { Redirect } from 'expo-router';

/** 상세 성과·체결 분석은 AOS Admin의 Shadow/Paper 원장으로 이관됐다. */
export default function LegacyTradeHistoryRedirect() {
  return <Redirect href="/(tabs)/portfolio" />;
}
