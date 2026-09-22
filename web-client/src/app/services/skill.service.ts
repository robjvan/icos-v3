import { Injectable, inject } from '@angular/core';
import { SKILLS_ENDPOINT } from '../../constants';
import type {
  SkillActiveResponse,
  SkillBody,
  SkillDiscoverResponse,
  SkillListResponse,
} from '../models/skill';
import { CoreApiService } from './core-api.service';

/**
 * Read-only skill inspection. The filesystem is the writer — there are no
 * skill mutations here, mirroring the core controller contract.
 */
@Injectable({ providedIn: 'root' })
export class SkillService {
  private readonly api = inject(CoreApiService);

  async list(): Promise<SkillListResponse> {
    return this.api.get<SkillListResponse>(SKILLS_ENDPOINT);
  }

  async discover(query: string): Promise<SkillDiscoverResponse> {
    return this.api.get<SkillDiscoverResponse>(`${SKILLS_ENDPOINT}/discover`, { q: query });
  }

  async active(sessionId: string): Promise<SkillActiveResponse> {
    return this.api.get<SkillActiveResponse>(`${SKILLS_ENDPOINT}/active`, { sessionId });
  }

  async body(name: string): Promise<SkillBody> {
    return this.api.get<SkillBody>(`${SKILLS_ENDPOINT}/${encodeURIComponent(name)}`);
  }
}
