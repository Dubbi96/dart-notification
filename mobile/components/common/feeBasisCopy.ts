// 성과 표면 공용 수수료 반영 기준 고지 정본 — UXR L-3 E-1.
// 시스템 모의(paper-simulation)·성과 리포트·전략/스타일 비교·백테스트 트랙레코드의 수익률은
// 모두 수수료·세금 등 비용을 차감한 순수익 기준(BE paper-simulation·backtest-replay)인데,
// 단타(IntradayScalpSection)만 '순수익(수수료 후)'을 명시해 트랙 간 비교 기준이 불명했다.
// 문구를 바꿀 일이 생기면 반드시 이 파일만 수정해 전 표면 일관성을 유지한다(copy 정본 패턴).

export const FEE_BASIS_NOTICE = '수수료·세금 등 비용 반영 순수익 기준';
