import { Linking, Platform } from 'react-native';

// DAR-545: 브로커 앱 핸드오프 딥링크 v1 — '증권사 앱에서 열기'의 SSOT.
// 공시온은 매매 불가(주문 미연동) 앱이라 '판단 후 실행'의 공백이 있다. 이 공백을 사용자가
// 이미 쓰는 대표 증권사 앱으로 넘겨(핸드오프) 메운다 — 신호 상세·종목 상세에서 1탭 링크아웃.
//
// ★정직 규약(기획 정직 라인):
//   - 특정 증권사를 추천하지 않는다 — 대표 MTS 를 가나다순으로 나열하고 고지 문구를 동반한다.
//   - 설치가 탐지되지 않으면(스킴 오픈 실패) 스토어 링크로 폴백한다 — '앱이 있는 척' 하지 않는다.
//   - 앱 내 계좌·주문 연동이 아니라 단순 '증권사 앱 열기' 링크아웃임을 카피로 분명히 한다(수집·저장 0).

export interface BrokerApp {
  /** 안정 식별자(가드/키). */
  id: string;
  /** 표시명(대표 MTS). */
  name: string;
  /** 설치돼 있을 때 앱을 실행하는 커스텀 스킴 URL. */
  appScheme: string;
  /** 미설치/스킴 실패 시 App Store 폴백(국가: kr). */
  iosStoreUrl: string;
  /** 미설치/스킴 실패 시 Play Store 폴백. */
  androidStoreUrl: string;
}

// 대표 3사(가나다순). 스킴·스토어 URL 은 공개 App Store/Play Store 등록정보 및 공개 스킴
// 레지스트리 기준(2026-07 확인). 추천이 아니라 대표성·점유율 상위 MTS 의 사전식 나열이다.
export const BROKER_APPS: readonly BrokerApp[] = [
  {
    id: 'kiwoom',
    name: '키움증권 영웅문S#',
    appScheme: 'heromts://',
    iosStoreUrl: 'https://apps.apple.com/kr/app/id1570370057',
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.kiwoom.heromts',
  },
  {
    id: 'samsung',
    name: '삼성증권 mPOP',
    appScheme: 'mpopapp://',
    iosStoreUrl: 'https://apps.apple.com/kr/app/id1150231646',
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.samsungpop.android.mpop',
  },
  {
    id: 'toss',
    name: '토스증권',
    appScheme: 'supertoss://',
    iosStoreUrl: 'https://apps.apple.com/kr/app/id839333328',
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=viva.republica.toss',
  },
] as const;

/** 시트 제목/트리거 라벨 — 화면 카피 SSOT. */
export const BROKER_HANDOFF_TITLE = '증권사 앱에서 열기';

/** 정직 고지(특정사 추천 아님 + 미설치 폴백 안내) — 화면 카피 SSOT. */
export const BROKER_HANDOFF_DISCLOSURE =
  '증권사 앱으로 이동만 합니다(계좌·주문 연동 아님). 특정 증권사를 추천하지 않으며, 앱이 설치돼 있지 않으면 앱스토어로 안내합니다.';

/** 플랫폼별 스토어 폴백 URL 선택(순수). */
export function brokerStoreUrl(broker: BrokerApp, platform: 'ios' | 'android'): string {
  return platform === 'ios' ? broker.iosStoreUrl : broker.androidStoreUrl;
}

/** 핸드오프 결과: 'app'=설치앱 실행, 'store'=미설치 스토어 폴백. */
export type BrokerOpenOutcome = 'app' | 'store';

interface OpenBrokerDeps {
  /** Linking.openURL 주입(테스트/가드용). 기본은 RN Linking. */
  openURL?: (url: string) => Promise<unknown>;
  /** 스토어 폴백 플랫폼 주입. 기본은 현재 OS. */
  platform?: 'ios' | 'android';
}

// 딥링크 오픈 2경로:
//   (1) 스킴 오픈 성공 → 'app'  (설치돼 있으면 해당 증권사 앱이 뜬다)
//   (2) 스킴 미지원/실패(미설치 등) → 스토어 폴백 → 'store'
//
// iOS canOpenURL 은 Info.plist LSApplicationQueriesSchemes 화이트리스트가 필요해(네이티브 변경·
// 재빌드 유발) v1 에서는 채택하지 않는다. 대신 openURL 시도→실패 캐치로 설치 여부를 판정한다 —
// 화이트리스트 불요, iOS/Android 동일 경로, JS-only(EAS 업데이트로 배포 가능).
export async function openBrokerApp(
  broker: BrokerApp,
  deps: OpenBrokerDeps = {},
): Promise<BrokerOpenOutcome> {
  const openURL = deps.openURL ?? ((url: string) => Linking.openURL(url));
  const platform = deps.platform ?? (Platform.OS === 'ios' ? 'ios' : 'android');
  try {
    await openURL(broker.appScheme);
    return 'app';
  } catch {
    // 미설치/스킴 미등록 → 스토어로 폴백(정직 규약: '앱이 있는 척' 금지).
    await openURL(brokerStoreUrl(broker, platform));
    return 'store';
  }
}
