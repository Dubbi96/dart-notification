import { Redirect } from 'expo-router';

/** 운영 비용·거버넌스 상세는 AOS Admin으로 이관됐다. */
export default function LegacyAiCostRedirect() {
  return <Redirect href="/(tabs)/settings" />;
}
