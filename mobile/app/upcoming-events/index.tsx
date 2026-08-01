import { Redirect } from 'expo-router';

/** 별도 이벤트 탐색 화면은 초기 AOS 핵심 IA에서 제거했다. */
export default function LegacyUpcomingEventsRedirect() {
  return <Redirect href="/disclosures" />;
}
