import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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

export const CLARIFICATION_STATUSES = [
  'pending',
  'answered',
  'cancelled',
  'expired',
] as const;

export class CreateClarificationDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;

  /**
   * Structured choices. When present: 2–10 unique options; answers must
   * equal one of them. Absent: free-form answer.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(30 * 24 * 60 * 60 * 1000)
  ttlMs?: number;
}

export class AnswerClarificationDto {
  /** Session binding: must own the clarification, else 400. */
  @IsUUID()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer!: string;
}

export class ResolveClarificationDto {
  @IsUUID()
  sessionId!: string;
}

export class ListClarificationsQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @IsIn([...CLARIFICATION_STATUSES])
  status?: (typeof CLARIFICATION_STATUSES)[number];
}
