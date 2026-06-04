import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LlmClient, LlmCompleteParams, LlmResult } from './llm-client';

/**
 * OpenAI 호환 Chat Completions 엔드포인트 구현.
 * env: LLM_API_KEY(필수) · LLM_BASE_URL(기본 OpenAI) · LLM_MODEL(기본 gpt-4o-mini)
 * 키 미설정 시 호출 시점에 명확히 실패한다(앱 부팅은 가능, 실제 호출만 차단).
 */
@Injectable()
export class HttpLlmClient extends LlmClient {
  private readonly logger = new Logger(HttpLlmClient.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  async complete(params: LlmCompleteParams): Promise<LlmResult> {
    const apiKey = this.config.get<string>('LLM_API_KEY');
    if (!apiKey) {
      throw new Error(
        'LLM_API_KEY 미설정 — Engine2 AI 호출 불가. .env에 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 설정 필요 (M3).',
      );
    }
    const baseUrl = this.config.get<string>('LLM_BASE_URL') ?? 'https://api.openai.com/v1';
    const model = this.config.get<string>('LLM_MODEL') ?? 'gpt-4o-mini';

    const { data } = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.user },
        ],
        max_tokens: params.maxOutputTokens ?? 1024,
        ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60_000 },
    );

    return {
      text: data?.choices?.[0]?.message?.content ?? '',
      model,
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
    };
  }
}
