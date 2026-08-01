import { Redirect } from 'expo-router';

/** 기존 자동매매 상태 딥링크는 AOS 제한 비상 제어로 연결한다. */
export default function LegacyAutoTradingRedirect() {
  return <Redirect href="/settings-detail/emergency-control" />;
}
