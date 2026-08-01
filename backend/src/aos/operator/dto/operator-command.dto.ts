import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class StepUpDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsIn(['CONFIG_CHANGE', 'APPROVAL', 'EMERGENCY_CONTROL', 'RECONCILIATION'])
  scope!: 'CONFIG_CHANGE' | 'APPROVAL' | 'EMERGENCY_CONTROL' | 'RECONCILIATION';
}

export class StrategyVersionRuleDto {
  @IsString()
  @IsNotEmpty()
  ruleDefinitionId!: string;

  @IsInt()
  @Min(0)
  priority!: number;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsObject()
  parametersJson!: Record<string, unknown>;
}

export class UpdateDraftVersionDto {
  @IsObject()
  configJson!: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StrategyVersionRuleDto)
  rules!: StrategyVersionRuleDto[];

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @IsNotEmpty()
  correlationId!: string;
}

export class ReasonedCommandDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  correlationId!: string;
}

export class CreateDraftVersionDto extends ReasonedCommandDto {
  @IsOptional()
  @IsString()
  parentVersionId?: string;
}

export class ApprovalDecisionDto extends ReasonedCommandDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';
}

export class ScheduleVersionDto extends ReasonedCommandDto {
  @IsString()
  @IsNotEmpty()
  scheduledFor!: string;
}

export class KillSwitchCommandDto extends ReasonedCommandDto {
  @IsIn(['ACTIVATE', 'DEACTIVATE_REQUEST', 'ACKNOWLEDGE'])
  command!: 'ACTIVATE' | 'DEACTIVATE_REQUEST' | 'ACKNOWLEDGE';

  @IsIn(['NEW_ENTRY', 'ACCOUNT', 'STRATEGY', 'ALL_ORDERS'])
  scope!: 'NEW_ENTRY' | 'ACCOUNT' | 'STRATEGY' | 'ALL_ORDERS';

  @IsIn(['REDUCE_ONLY', 'FULL_HALT'])
  mode!: 'REDUCE_ONLY' | 'FULL_HALT';

  @IsOptional()
  @IsString()
  scopeRefId?: string;
}

export class ResolveBreakDto extends ReasonedCommandDto {
  @IsIn(['EXPLAINED', 'RESOLVED'])
  resolution!: 'EXPLAINED' | 'RESOLVED';

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  reasonCode!: string;
}

export class CreateAllocationPolicyDto extends ReasonedCommandDto {
  @IsObject()
  profitPeriodPolicyJson!: Record<string, unknown>;

  @IsObject()
  taxReservePolicyJson!: Record<string, unknown>;

  @IsObject()
  fxPolicyJson!: Record<string, unknown>;

  @IsObject()
  minimumAmountPolicyJson!: Record<string, unknown>;
}

export class CreateAllocationPlanDto extends ReasonedCommandDto {
  @IsString()
  @IsNotEmpty()
  tradingAccountId!: string;

  @IsISO8601({ strict: true })
  periodStart!: string;

  @IsISO8601({ strict: true })
  periodEnd!: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000_000_000)
  grossRealizedProfitKrw!: number;

  @IsInt()
  @Min(0)
  @Max(100_000_000_000_000)
  taxReserveKrw!: number;

  @IsInt()
  @Min(0)
  @Max(100_000_000_000_000)
  fxReserveKrw!: number;

  @IsObject()
  sourceEvidenceJson!: Record<string, unknown>;
}

export class ReissueAllocationPlanDto extends CreateAllocationPlanDto {}
