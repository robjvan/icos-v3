import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavTabsComponent } from '../nav-tabs-component/nav-tabs-component';
import { FooterComponent } from '../footer-component/footer-component';

@Component({
  selector: 'app-dashboard-page',
  imports: [NavTabsComponent, RouterOutlet, FooterComponent],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {}
