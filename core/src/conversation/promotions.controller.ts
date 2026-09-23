import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { PromotionService } from '../memory/promotion.service';
import {
  ListPendingPromotionsResponseDto,
  RunPromotionsResponseDto,
} from './dto/promotions.dto';

/**
 * Explicit promotion driver. Approving a `memory.promote` request
 * records authority; this endpoint executes it — the same pull
 * pattern as tool-approval resume. Manual trigger, post-approval
 * driver, and crash-recovery path in one idempotent sweep.
 */
@Controller('core/promotions')
export class PromotionsController {
  constructor(private readonly promotion: PromotionService) {}

  @Post('run')
  @HttpCode(200)
  async run(): Promise<RunPromotionsResponseDto> {
    return { summary: await this.promotion.sweep() };
  }

  @Get('pending')
  async pending(): Promise<ListPendingPromotionsResponseDto> {
    return { pending: await this.promotion.listPending() };
  }
}
