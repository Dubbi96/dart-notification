export type FeatureSnapshotJsonPrimitive = string | number | boolean | null;

export type FeatureSnapshotJsonValue =
  | FeatureSnapshotJsonPrimitive
  | { readonly [key: string]: FeatureSnapshotJsonValue }
  | readonly FeatureSnapshotJsonValue[];

export interface FeatureSnapshotJsonObject {
  readonly [key: string]: FeatureSnapshotJsonValue;
}

export interface FeatureQualityInput {
  readonly missingFeatureKeys: readonly string[];
  readonly staleFeatureKeys: readonly string[];
  readonly validationErrors: readonly string[];
}

export interface FeatureSnapshotInput {
  readonly instrumentType?: 'KR_STOCK';
  readonly corpCode: string;
  readonly stockCode: string;
  readonly asOf: Date;
  readonly marketSessionDate: string;
  readonly schemaVersion: string;
  readonly features: unknown;
  readonly sourceRefs: unknown;
  readonly quality: FeatureQualityInput;
}

export interface CanonicalFeatureSnapshot {
  readonly instrumentType: 'KR_STOCK';
  readonly corpCode: string;
  readonly stockCode: string;
  readonly asOf: string;
  readonly marketSessionDate: string;
  readonly schemaVersion: string;
  readonly features: FeatureSnapshotJsonObject;
  readonly sourceRefs: FeatureSnapshotJsonObject;
  readonly quality: FeatureQualityInput;
  readonly contentHash: string;
}

export type FeatureSnapshotDomainErrorCode = 'INVALID_FEATURE_SNAPSHOT' | 'INVALID_FEATURE_JSON';

export class FeatureSnapshotDomainError extends Error {
  constructor(
    readonly code: FeatureSnapshotDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FeatureSnapshotDomainError';
  }
}
