import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
] as const;

export class CreateApprovalDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  action!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * Decision deadline, milliseconds from creation. Omitted = no deadline.
   * Lapsed requests flip to `expired` on next read (no sweeper).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(30 * 24 * 60 * 60 * 1000)
  ttlMs?: number;
}

export class ResolveApprovalDto {
  /** Session binding: must own the approval, else 400. */
  @IsUUID()
  sessionId!: string;
}

export class ListApprovalsQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @IsIn([...APPROVAL_STATUSES])
  status?: (typeof APPROVAL_STATUSES)[number];
}
