import { Redirect } from 'expo-router';

/** 장중 단타 트랙은 국내주식 2~20일 AOS 초기 범위에서 격리한다. */
export default function LegacyIntradayRedirect() {
  return <Redirect href="/(tabs)/portfolio" />;
}
