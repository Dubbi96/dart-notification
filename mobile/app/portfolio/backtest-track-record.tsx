import { Redirect } from 'expo-router';

/** 백테스트 상세는 AOS Admin으로 이관됐다. */
export default function LegacyBacktestRedirect() {
  return <Redirect href="/(tabs)/portfolio" />;
}
