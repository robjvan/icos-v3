import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { LucideSearch } from '@lucide/angular';
import { ConversationStore } from '../../services/conversation-store';
import { SkillService } from '../../services/skill.service';
import type { SkillBody, SkillDescriptor, SkillMatch } from '../../models/skill';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/**
 * Skills tab: live read-only views over `GET /core/skills*`. The filesystem
 * is the writer — no CRUD controls exist because the API has no mutations.
 */
@Component({
  selector: 'app-skills-tab',
  imports: [ReactiveFormsModule, LucideSearch, TabPlaceholder],
  templateUrl: './skills-tab.html',
  styleUrl: './skills-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsTab implements OnInit {
  private readonly skillsApi = inject(SkillService);
  private readonly store = inject(ConversationStore);

  readonly skills = signal<readonly SkillDescriptor[]>([]);
  readonly enabled = signal(true);
  readonly skippedCount = signal(0);
  readonly matches = signal<readonly SkillMatch[]>([]);
  readonly detail = signal<SkillBody | null>(null);
  readonly error = signal<string | null>(null);

  readonly searchForm = new FormGroup({
    query: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const catalog = await this.skillsApi.list();
      this.enabled.set(catalog.enabled);
      this.skills.set(catalog.skills);
      this.skippedCount.set(catalog.skipped.length);
    } catch (error) {
      this.skills.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  async discover(): Promise<void> {
    const query = this.searchForm.controls.query.value.trim();
    if (!query) {
      return;
    }
    this.error.set(null);
    try {
      const result = await this.skillsApi.discover(query);
      this.matches.set(result.matches);
    } catch (error) {
      this.matches.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  async openSkill(name: string): Promise<void> {
    this.error.set(null);
    try {
      this.detail.set(await this.skillsApi.body(name));
    } catch (error) {
      this.detail.set(null);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  closeSkill(): void {
    this.detail.set(null);
  }

  currentSessionId(): string | null {
    return this.store.sessionId();
  }
}
