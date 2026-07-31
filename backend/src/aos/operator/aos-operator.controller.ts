import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  ApprovalDecisionDto,
  CreateDraftVersionDto,
  KillSwitchCommandDto,
  ReasonedCommandDto,
  ResolveBreakDto,
  ScheduleVersionDto,
  StepUpDto,
  UpdateDraftVersionDto,
} from './dto/operator-command.dto';
import {
  OperatorAccessGuard,
  OperatorPrincipal,
  RequireOperatorPermissions,
} from './guards/operator-access.guard';
import {
  ConsumedStepUp,
  OperatorStepUpGuard,
  RequireStepUp,
} from './guards/operator-step-up.guard';
import { AosOperatorCommandService } from './services/aos-operator-command.service';
import { AosOperatorQueryService } from './services/aos-operator-query.service';
import { AosStepUpService } from './services/aos-step-up.service';

interface OperatorRequest {
  user: { id: string; email: string };
  operator: OperatorPrincipal;
  consumedStepUp: ConsumedStepUp;
}

@ApiTags('AOS Operator')
@ApiBearerAuth()
@Controller('aos/operator')
@UseGuards(JwtAuthGuard, OperatorAccessGuard)
export class AosOperatorController {
  constructor(
    private readonly queryService: AosOperatorQueryService,
    private readonly commandService: AosOperatorCommandService,
    private readonly stepUpService: AosStepUpService,
  ) {}

  @Get('bootstrap')
  async bootstrap(@Req() request: OperatorRequest) {
    return ok(await this.queryService.bootstrap(request.operator));
  }

  @Get('strategies')
  async strategies() {
    return ok(await this.queryService.strategies());
  }

  @Get('strategy-versions/:id')
  async strategyVersion(@Param('id') id: string, @Query('compareTo') compareTo?: string) {
    return ok(await this.queryService.strategyVersion(id, compareTo));
  }

  @Get('backtests')
  async backtests(@Query('limit') limit?: string) {
    return ok(await this.queryService.backtests(number(limit)));
  }

  @Get('shadow')
  async shadow(@Query('limit') limit?: string) {
    return ok(await this.queryService.shadow(number(limit)));
  }

  @Get('audit')
  async audit(@Query('limit') limit?: string) {
    return ok(await this.queryService.audit(number(limit)));
  }

  @Get('health')
  async health(@Query('limit') limit?: string) {
    return ok(await this.queryService.health(number(limit)));
  }

  @Get('replay/decisions/:id')
  async replayDecision(@Param('id') id: string) {
    return ok(await this.queryService.replayDecision(id));
  }

  @Post('auth/step-up')
  async stepUp(@Req() request: OperatorRequest, @Body() dto: StepUpDto) {
    return ok(await this.stepUpService.issue(request.operator.userId, dto.password, dto.scope));
  }

  @Post('strategies/:strategyId/versions')
  @RequireOperatorPermissions('CONFIG_WRITE')
  @RequireStepUp('CONFIG_CHANGE')
  @UseGuards(OperatorStepUpGuard)
  async createDraft(
    @Param('strategyId') strategyId: string,
    @Req() request: OperatorRequest,
    @Body() dto: CreateDraftVersionDto,
  ) {
    return ok(
      await this.commandService.createDraft(
        strategyId,
        dto,
        request.operator,
        request.consumedStepUp,
      ),
    );
  }

  @Patch('strategy-versions/:id/draft')
  @RequireOperatorPermissions('CONFIG_WRITE')
  @RequireStepUp('CONFIG_CHANGE')
  @UseGuards(OperatorStepUpGuard)
  async updateDraft(
    @Param('id') id: string,
    @Req() request: OperatorRequest,
    @Body() dto: UpdateDraftVersionDto,
  ) {
    return ok(
      await this.commandService.updateDraft(id, dto, request.operator, request.consumedStepUp),
    );
  }

  @Post('strategy-versions/:id/validate')
  @RequireOperatorPermissions('CONFIG_WRITE')
  @RequireStepUp('CONFIG_CHANGE')
  @UseGuards(OperatorStepUpGuard)
  async validateVersion(
    @Param('id') id: string,
    @Req() request: OperatorRequest,
    @Body() dto: ReasonedCommandDto,
  ) {
    return ok(
      await this.commandService.validateVersion(id, dto, request.operator, request.consumedStepUp),
    );
  }

  @Post('strategy-versions/:id/attest-backtest')
  @RequireOperatorPermissions('CONFIG_WRITE')
  @RequireStepUp('CONFIG_CHANGE')
  @UseGuards(OperatorStepUpGuard)
  async attestBacktest(
    @Param('id') id: string,
    @Req() request: OperatorRequest,
    @Body() dto: ReasonedCommandDto,
  ) {
    return ok(
      await this.commandService.attestBacktest(id, dto, request.operator, request.consumedStepUp),
    );
  }

  @Post('strategy-versions/:id/request-approval')
  @RequireOperatorPermissions('CONFIG_WRITE')
  @RequireStepUp('CONFIG_CHANGE')
  @UseGuards(OperatorStepUpGuard)
  async requestApproval(
    @Param('id') id: string,
    @Req() request: OperatorRequest,
    @Body() dto: ReasonedCommandDto,
  ) {
    return ok(
      await this.commandService.requestApproval(id, dto, request.operator, request.consumedStepUp),
    );
  }

  @Post('strategy-versions/:id/approval')
  @RequireOperatorPermissions('CONFIG_APPROVE')
  @RequireStepUp('APPROVAL')
  @UseGuards(OperatorStepUpGuard)
  async decideApproval(
    @Param('id') id: string,
    @Req() request: OperatorRequest,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return ok(
      await this.commandService.decideApproval(id, dto, request.operator, request.consumedStepUp),
    );
  }

  @Post('strategy-versions/:id/schedule')
  @RequireOperatorPermissions('CONFIG_APPROVE')
  @RequireStepUp('APPROVAL')
  @UseGuards(OperatorStepUpGuard)
  async schedule(
    @Param('id') id: string,
    @Req() request: OperatorRequest,
    @Body() dto: ScheduleVersionDto,
  ) {
    return ok(
      await this.commandService.schedule(id, dto, request.operator, request.consumedStepUp),
    );
  }

  @Post('emergency/kill-switch')
  @RequireOperatorPermissions('EMERGENCY_CONTROL')
  @RequireStepUp('EMERGENCY_CONTROL')
  @UseGuards(OperatorStepUpGuard)
  async killSwitch(@Req() request: OperatorRequest, @Body() dto: KillSwitchCommandDto) {
    return ok(
      await this.commandService.controlKillSwitch(dto, request.operator, request.consumedStepUp),
    );
  }

  @Post('reconciliation-breaks/:id/resolve')
  @RequireOperatorPermissions('RECONCILIATION_RESOLVE')
  @RequireStepUp('RECONCILIATION')
  @UseGuards(OperatorStepUpGuard)
  async resolveBreak(
    @Param('id') id: string,
    @Req() request: OperatorRequest,
    @Body() dto: ResolveBreakDto,
  ) {
    return ok(
      await this.commandService.resolveBreak(id, dto, request.operator, request.consumedStepUp),
    );
  }
}

function ok<T>(data: T) {
  return { success: true as const, data };
}

function number(value?: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 50;
}
