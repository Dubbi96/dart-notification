/**
 * LLM 클라이언트 포트(추상). NestJS DI 토큰으로도 사용한다.
 * 구현은 교체 가능(OpenAI 호환·Anthropic·로컬). 테스트는 이 추상에 mock을 주입한다.
 */
export interface LlmCompleteParams {
  system: string;
  user: string;
  maxOutputTokens?: number;
  jsonMode?: boolean; // JSON 출력 강제
}

export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export abstract class LlmClient {
  abstract complete(params: LlmCompleteParams): Promise<LlmResult>;
}
