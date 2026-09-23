import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

describe('routes', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should declare every blueprint tab as a lazy child route', () => {
    const paths = [
      '',
      'agents',
      'tools',
      'skills',
      'files',
      'memory',
      'kb',
      'sensors',
      'mcp',
      'models',
      'cron',
      'metrics',
      'client-settings',
      'server-settings',
      'comms',
      'identity',
    ];
    const shell = routes[0];
    expect(shell?.path).toBe('');
    const children = (shell as { children?: typeof routes })?.children ?? [];
    expect(children).toHaveLength(paths.length);
    for (const path of paths) {
      const match = children.find((route) => route.path === path);
      expect(match).toBeDefined();
      expect(typeof match?.loadComponent).toBe('function');
    }
  });

  it('should lazily resolve the chat route to a component', async () => {
    const shell = routes[0];
    const children = (shell as { children?: typeof routes })?.children ?? [];
    const chat = children.find((route) => route.path === '');
    const component = await chat?.loadComponent?.();
    expect(component).toBeDefined();
  }, 15000);
});
