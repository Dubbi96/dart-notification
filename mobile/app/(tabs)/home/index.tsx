import { Redirect } from 'expo-router';

/** 기존 딥링크 호환용. AOS의 첫 화면은 종가 후 운영 브리핑이다. */
export default function LegacyHomeRedirect() {
  return <Redirect href="/(tabs)/signals" />;
}
