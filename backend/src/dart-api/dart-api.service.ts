import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';

@Injectable()
export class DartApiService {
  private readonly logger = new Logger(DartApiService.name);
  private readonly httpClient: AxiosInstance;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('DART_API_KEY', '');

    this.httpClient = axios.create({
      baseURL: 'https://opendart.fss.or.kr/api',
      timeout: 30000,
    });

    axiosRetry(this.httpClient, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
    });
  }

  async getDisclosureList(params: {
    bgn_de: string;
    end_de: string;
    page_no?: number;
    page_count?: number;
  }) {
    try {
      const response = await this.httpClient.get('/list.json', {
        params: {
          crtfc_key: this.apiKey,
          ...params,
          page_count: params.page_count || 100,
        },
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch disclosure list from DART API', error);
      throw error;
    }
  }
}
