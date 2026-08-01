import { Redirect } from 'expo-router';

/** 전략 비교·파라미터 상세는 AOS Admin으로 이관됐다. */
export default function LegacyStrategyRedirect() {
  return <Redirect href="/(tabs)/portfolio" />;
}
