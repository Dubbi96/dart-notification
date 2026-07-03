// backend/src/common/storage/etf-daily-raw-store.service.ts
// DAR-490: ETF 과거 일봉 백필 시 KIS 기간별시세 '원본 응답(JSON)'을 객체 스토리지(S3/로컬)에 보관하는
//          스토어 — 쓰기(백필 아카이브)의 단일 출처. rawText(DAR-395)·rawHtml(DAR-401) 오프로드와
//          동일 설계(결정적 키·gzip·graceful). DB(EtfDailyPrice)는 정규화 시세만, 원본은 S3 콜드 보관.
//
// 배경(DAR-401 원칙): raw 는 S3, 결정적 키. 정규화 손실 없는 원본을 보관해 백테스트(P16) 데이터 품질
//   판단 시 KIS 원천 응답을 재검증할 수 있게 한다(정규화·손상행 배제 이전의 진본).
//
// 키 규약: etf-daily-raw/{etfCode}/{startYmd}-{endYmd}.json.gz (gzip 압축, 결정적 키).

import { Injectable, Logger } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.types';

@Injectable()
export class EtfDailyRawStoreService {
  private readonly logger = new Logger(EtfDailyRawStoreService.name);

  constructor(private readonly storage: ObjectStorageService) {}

  /**
   * (etfCode, 조회구간) → 객체 키(SSOT). 정적·결정적이라 재실행·외부 도구도 키를 재현한다.
   * 구간을 키에 포함해 백필 창(window)별로 원본을 1:1 아카이브한다(멱등 덮어쓰기).
   */
  static keyFor(etfCode: string, startYmd: string, endYmd: string): string {
    return `etf-daily-raw/${etfCode}/${startYmd}-${endYmd}.json.gz`;
  }

  /** 활성 스토리지 드라이버(관측·진단). */
  get driver(): string {
    return this.storage.driver;
  }

  /** 외부 스토리지(S3) 구성 여부(관측·진단 — 로컬 폴백 표면화). */
  isConfigured(): boolean {
    return this.storage.isConfigured();
  }

  /**
   * KIS 원본 응답(JSON) 보관(gzip 업로드). 반환 키는 결정적이라 DB 포인터 없이도 재현 가능.
   * 멱등: 동일 구간 재보관은 같은 키 덮어쓰기(백필 재실행 무해). 실패 시 throw —
   * 호출측(백필 러너)이 best-effort 로 흡수한다(원본 보관 실패가 DB 적재를 막지 않는다).
   */
  async save(
    etfCode: string,
    startYmd: string,
    endYmd: string,
    raw: unknown,
  ): Promise<string> {
    const key = EtfDailyRawStoreService.keyFor(etfCode, startYmd, endYmd);
    await this.storage.put(key, JSON.stringify(raw), {
      compress: true,
      contentType: 'application/json; charset=utf-8',
    });
    return key;
  }
}
