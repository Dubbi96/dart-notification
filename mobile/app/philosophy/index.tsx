import { Redirect } from 'expo-router';

/** 철학 오버레이는 초기 AOS active strategy가 아니라 연구 영역이다. */
export default function LegacyPhilosophyRedirect() {
  return <Redirect href="/(tabs)/signals" />;
}
