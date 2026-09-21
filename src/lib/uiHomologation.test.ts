import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
const css = readFileSync(join(root, 'src', 'styles', 'v15.8.1-global-visual-system.css'), 'utf8');
const footer = readFileSync(join(root, 'src', 'components', 'SiteFooter.tsx'), 'utf8');

const routeContracts = [
  ['/business-setup', 'business-setup-shell-v122'],
  ['/admin/*', 'admin-shell-v14'],
  ['/app', 'workout-layout'],
  ['/workspace', 'workspace-shell-v122'],
  ['/profile', 'profile-shell-v9'],
  ['/notifications', 'notifications-shell-v113'],
  ['/gymbros', 'gymbros-page-v9'],
  ['/challenges', 'challenges-page-v10'],
  ['/squads', 'squads-page-v11'],
  ['/sponsored-challenges', 'sponsored-page-v13'],
  ['/seasons', 'season-shell-v157'],
  ['/rewards', 'rewards-page-v15'],
  ['/rewards/manage', 'reward-editor-v15'],
  ['/rewards/analytics', 'reward-analytics-card-v154'],
  ['/rewards/validate', 'reward-validator-v152'],
  ['/organizations', 'organizations-shell-v12'],
  ['/organization-challenges', 'organization-challenges-page-v12'],
  ['/gym-battles', 'gym-battles-shell-v121'],
  ['/brand-campaigns', 'brand-campaigns-shell-v13'],
  ['/brand-competitions', 'brand-competition-shell-v157'],
  ['/brand-audit', 'brand-audit-shell-v133'],
] as const;

const deepSurfaceContracts = [
  ['/app', ['.workout-layout .dice-card', '.workout-layout .exercise-cube', '.workout-layout .metadata-grid-v7 > div', '.workout-layout .evidence-section-v7', '.workout-layout .history-card-v7']],
  ['/workspace', ['.workspace-shell-v122 .workspace-hero-v122', '.workspace-shell-v122 .workspace-stats-v122 > *', '.workspace-shell-v122 .workspace-action-grid-v122 > *']],
  ['/profile', ['.profile-shell-v9 .profile-card-v9', '.profile-shell-v9 .profile-stats-v9 > article', '.profile-shell-v9 .sponsor-wallet-grid-eco1 > article']],
  ['/notifications', ['.notifications-shell-v113 .notifications-list-card-v113', '.notifications-shell-v113 .notifications-list-v113 > *']],
  ['/gymbros', ['.profile-shell-v9 .gymbros-page-v9 .gymbro-search-card-v9', '.profile-shell-v9 .gymbros-page-v9 .gymbro-row-v9', '.profile-shell-v9 .gymbros-page-v9 .gymbro-list-v9']],
  ['/challenges', ['.profile-shell-v9 .challenges-page-v10 .challenge-card-v10', '.profile-shell-v9 .challenges-page-v10 .challenge-evidence-item-v10']],
  ['/squads', ['.profile-shell-v9 .squads-page-v11 .squad-roster-v11', '.profile-shell-v9 .squads-page-v11 .squad-evidence-item-v11']],
  ['/sponsored-challenges', ['.profile-shell-v9 .sponsored-page-v13 .sponsored-card-v13', '.profile-shell-v9 .sponsored-page-v13 .sponsored-exercise-v13']],
  ['/seasons', ['.season-shell-v157 .season-card-v157', '.season-shell-v157 .season-ranking-v157 article']],
  ['/rewards', ['.rewards-page-v15 .reward-card-v15', '.rewards-page-v15 .reward-body-v15']],
  ['/rewards/manage', ['.rewards-page-v15 .reward-editor-v15', '.rewards-page-v15 .fulfillment-box-v151']],
  ['/rewards/analytics', ['.rewards-page-v15 .reward-analytics-card-v154', '.rewards-page-v15 .reward-analytics-kpis-v154 > *']],
  ['/rewards/validate', ['.rewards-page-v15 .reward-validator-v152', '.rewards-page-v15 .reward-validation-grid-v152 > *']],
  ['/organizations', ['.organizations-shell-v12 .organization-card-v12', '.organizations-shell-v12 .organization-member-row-v12']],
  ['/organization-challenges', ['.profile-shell-v9 .organization-challenges-page-v12 .organization-challenge-card-v12', '.profile-shell-v9 .organization-challenges-page-v12 .organization-evidence-v12']],
  ['/gym-battles', ['.gym-battles-shell-v121 .gym-battle-card-v121', '.gym-battles-shell-v121 .gym-battle-evidence-v121']],
  ['/brand-campaigns', ['.brand-campaigns-shell-v13 .brand-campaign-card-v13', '.brand-campaigns-shell-v13 .sponsored-goal-builder-v132']],
  ['/brand-competitions', ['.brand-competition-shell-v157 .brand-competition-form-v157', '.brand-competition-shell-v157 .brand-gym-picker-v157']],
  ['/brand-audit', ['.brand-audit-shell-v133 .audit-card-v133', '.brand-audit-shell-v133 .audit-history-row-v133']],
  ['/business-setup', ['.business-setup-shell-v122 .business-setup-card-v122']],
  ['/admin/*', ['.admin-shell-v14 .admin-sidebar-v14', '.admin-shell-v14 .admin-card-v14', '.admin-shell-v14 .admin-table-wrap-v14', '.admin-shell-v14 .admin-kpi-grid-v14 > *']],
] as const;

function protectedRoutes(source: string) {
  const rows = source.split(/\r?\n/);
  return rows.flatMap((line) => {
    const match = line.match(/<Route\s+path="([^"]+)"\s+element=\{<ProtectedRoute>/);
    return match ? [match[1]] : [];
  });
}

const finalMarker = 'DadoFit V15.9.1 — FULL PRODUCT HOMOLOGATION';
const finalCss = css.slice(css.indexOf(finalMarker));

describe('V15.9.1 full product homologation guard', () => {
  it('covers every protected route declared in App.tsx', () => {
    expect(protectedRoutes(app).sort()).toEqual(routeContracts.map(([route]) => route).sort());
  });

  it.each(routeContracts)('%s has an explicit route anchor in the final visual layer', (_route, anchor) => {
    expect(finalCss).toContain(`.${anchor}`);
  });

  for (const [route, selectors] of deepSurfaceContracts) {
    it(`${route} has deep surface parity coverage`, () => {
      for (const selector of selectors) expect(finalCss).toContain(selector);
    });
  }

  it('uses the canonical surface contract', () => {
    expect(finalCss).toContain('--dfg-v1591-canvas: #070907;');
    expect(finalCss).toContain('--dfg-v1591-primary: #0d100e;');
    expect(finalCss).toContain('--dfg-v1591-nested: #111511;');
    expect(finalCss).toContain('--dfg-v1591-raised: #151916;');
    expect(finalCss).toContain('--dfg-v1591-lime: #c8ff19;');
  });

  it('does not use :where() in the final parity layer', () => {
    expect(finalCss).not.toContain(':where(');
  });

  it('keeps the global visual stylesheet loaded after ECO-3', () => {
    const eco3 = app.indexOf('./styles/v15.7.15-eco3-marketplace.css');
    const global = app.indexOf('./styles/v15.8.1-global-visual-system.css');
    expect(eco3).toBeGreaterThanOrEqual(0);
    expect(global).toBeGreaterThan(eco3);
  });

  it('does not reintroduce discarded Claude modernist styles', () => {
    expect(app).not.toContain('dadofit-modernist-');
  });

  it('homologates the product footer separately from route shells', () => {
    expect(footer).toContain('site-footer-v141');
    expect(finalCss).toContain('.site-footer-v141');
    expect(finalCss).toContain('.site-footer-commercial-v141');
    expect(finalCss).toContain('.site-footer-bottom-v141');
    expect(finalCss).toContain('.site-footer-accent-v141');
  });

  it('removes legacy footer navy and tri-color values from the final parity layer', () => {
    for (const legacy of ['#111827', '#2384e3', '#fd572a']) expect(finalCss).not.toContain(legacy);
  });

  it('does not reuse the legacy blue-gray panel palette in the final parity layer', () => {
    for (const legacy of ['#191f29', '#151b24', '#202733', '#272b2f', '#1f242a']) expect(finalCss).not.toContain(legacy);
  });
});
