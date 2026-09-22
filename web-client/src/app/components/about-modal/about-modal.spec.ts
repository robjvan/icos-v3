import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AboutModal } from './about-modal';

describe('AboutModal', () => {
  let component: AboutModal;
  let fixture: ComponentFixture<AboutModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AboutModal],
    }).compileComponents();

    fixture = TestBed.createComponent(AboutModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
