// backend/src/common/storage/s3-backend.ts
// DAR-395: AWS SDK(@aws-sdk/client-s3) lazy-require 어댑터 + 구성 팩토리.
//
// ★의도적 lazy-require: @aws-sdk/client-s3 를 정적 import 하지 않는다. 자격증명이 후속 주입될
//   때까지 SDK 를 의존성에 강제하지 않기 위함이다(미설치/미구성 시 createAwsS3Backend 가 null →
//   호출측이 로컬로 폴백 → 기능 비차단). 사용자가 버킷·자격증명을 제공하고
//   `npm i @aws-sdk/client-s3` 하면 그대로 활성화된다.

import { Logger } from '@nestjs/common';
import { S3Backend } from './s3-object-storage.service';

const logger = new Logger('AwsS3Backend');

/** S3 구성 — env 에서 해석. */
export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** S3 호환 스토리지(MinIO 등) 커스텀 엔드포인트. */
  endpoint?: string;
  /** 버킷 내 공통 prefix. */
  prefix?: string;
  /** path-style 강제(MinIO 등). */
  forcePathStyle?: boolean;
}

// ── @aws-sdk/client-s3 의 최소 구조 타입(정적 import 회피용 — 설치 시 런타임 호환) ──
interface S3CommandCtor {
  new (input: Record<string, unknown>): object;
}
interface S3ClientLike {
  send(command: object): Promise<{
    Body?: {
      transformToByteArray?: () => Promise<Uint8Array>;
      // Node Readable 폴백
      [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
    };
  }>;
}
interface S3Sdk {
  S3Client: new (cfg: Record<string, unknown>) => S3ClientLike;
  PutObjectCommand: S3CommandCtor;
  GetObjectCommand: S3CommandCtor;
  HeadObjectCommand: S3CommandCtor;
  DeleteObjectCommand: S3CommandCtor;
}

/** 자격증명/버킷/리전이 모두 갖춰졌는지 — 미충족이면 S3 비활성(로컬 폴백). */
export function isS3Configured(cfg: Partial<S3Config>): cfg is S3Config {
  return Boolean(cfg.region && cfg.bucket);
}

/** AWS SDK 를 lazy-require. 미설치면 null(폴백 신호). */
function loadSdk(): S3Sdk | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@aws-sdk/client-s3') as S3Sdk;
  } catch {
    return null;
  }
}

/** 응답 Body → Buffer(SdkStream.transformToByteArray 우선, Readable 폴백). */
async function bodyToBuffer(body: {
  transformToByteArray?: () => Promise<Uint8Array>;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
}): Promise<Buffer> {
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  // Node Readable 폴백(스트림 순회).
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * S3 백엔드 생성. 구성 미충족 또는 SDK 미설치 시 null 반환(호출측 로컬 폴백).
 * 네트워크 호출은 실제 사용 시점(put/get)에만 발생 — 부팅 차단 없음.
 */
export function createAwsS3Backend(cfg: Partial<S3Config>): S3Backend | null {
  if (!isS3Configured(cfg)) {
    return null;
  }
  const sdk = loadSdk();
  if (!sdk) {
    logger.warn(
      '@aws-sdk/client-s3 미설치 — S3 비활성(로컬 폴백). `npm i @aws-sdk/client-s3` 후 활성화됩니다.',
    );
    return null;
  }

  const clientConfig: Record<string, unknown> = { region: cfg.region };
  if (cfg.endpoint) clientConfig.endpoint = cfg.endpoint;
  if (cfg.forcePathStyle) clientConfig.forcePathStyle = true;
  if (cfg.accessKeyId && cfg.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    };
  }
  // 자격증명 미지정 시 SDK 기본 자격증명 체인(IAM 역할/인스턴스 프로파일) 사용.

  const client = new sdk.S3Client(clientConfig);
  const bucket = cfg.bucket;

  return {
    async putObject({ key, body, contentType, contentEncoding }) {
      await client.send(
        new sdk.PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentEncoding: contentEncoding,
        }),
      );
    },
    async getObject(key) {
      const res = await client.send(
        new sdk.GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!res.Body) throw new Error(`S3 객체 본문 없음: ${key}`);
      return bodyToBuffer(res.Body);
    },
    async headObject(key) {
      try {
        await client.send(
          new sdk.HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return true;
      } catch {
        return false;
      }
    },
    async deleteObject(key) {
      await client.send(
        new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    },
  };
}
