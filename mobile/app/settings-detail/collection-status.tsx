import { Redirect } from 'expo-router';

/** 수집·Worker 상태는 AOS Admin으로 이관됐다. */
export default function LegacyCollectionStatusRedirect() {
  return <Redirect href="/(tabs)/settings" />;
}
