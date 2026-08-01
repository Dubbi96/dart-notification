import { Redirect } from 'expo-router';

/** 초기 AOS 범위에서 소비자 Pro 화면은 격리한다. */
export default function LegacyProRedirect() {
  return <Redirect href="/(tabs)/settings" />;
}
