import type {
  PromotionJournalEntry,
  SweepSummary,
} from '../../memory/promotion';

export class RunPromotionsResponseDto {
  summary!: SweepSummary;
}

export type PendingPromotion = PromotionJournalEntry & {
  approvalStatus: string | null;
};

export class ListPendingPromotionsResponseDto {
  pending!: PendingPromotion[];
}
