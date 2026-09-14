import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApprovalService } from './approval.service';
import {
  CreateApprovalDto,
  ListApprovalsQueryDto,
  ResolveApprovalDto,
} from './dto/approvals.dto';

/**
 * Explicit human-approval API. Every mutation requires the owning
 * `sessionId` in the body — an LLM response can never satisfy that, so
 * assistant text is structurally incapable of approving anything.
 */
@Controller('core/approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateApprovalDto) {
    return this.approvals.create({
      sessionId: dto.sessionId,
      action: dto.action,
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.ttlMs !== undefined ? { ttlMs: dto.ttlMs } : {}),
    });
  }

  @Get()
  async list(@Query() query: ListApprovalsQueryDto) {
    const approvals = await this.approvals.list({
      ...(query.sessionId !== undefined ? { sessionId: query.sessionId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    });
    return { approvals };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.approvals.get(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() dto: ResolveApprovalDto) {
    return this.approvals.approve(id, dto.sessionId);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() dto: ResolveApprovalDto) {
    return this.approvals.reject(id, dto.sessionId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() dto: ResolveApprovalDto) {
    return this.approvals.cancel(id, dto.sessionId);
  }
}
