import { Redirect } from 'expo-router';

/** Event Study 원시는 판단 카드의 근거 상세에서만 제공한다. */
export default function LegacyEventStatsRedirect() {
  return <Redirect href="/(tabs)/signals" />;
}
