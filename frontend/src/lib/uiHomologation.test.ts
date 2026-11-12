import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
const css = readFileSync(join(root, 'src', 'styles', 'v15.8.1-global-visual-system.css'), 'utf8');
const footer = readFileSync(join(root, 'src', 'components', 'SiteFooter.tsx'), 'utf8');
const organizationChallenges = readFileSync(join(root, 'src', 'pages', 'OrganizationChallengesPage.tsx'), 'utf8');
const gymBattles = readFileSync(join(root, 'src', 'pages', 'GymBattlesPage.tsx'), 'utf8');
const workout = readFileSync(join(root, 'src', 'pages', 'WorkoutPage.tsx'), 'utf8');
const rewardsMarketplace = readFileSync(join(root, 'src', 'pages', 'RewardsMarketplacePage.tsx'), 'utf8');
const organizationsPage = readFileSync(join(root, 'src', 'pages', 'OrganizationsPage.tsx'), 'utf8');

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

  it('extends the workout orbit identity across product containers', () => {
    expect(css).toContain('DadoFit V15.9.3 — Container orbit identity');
    expect(css).toContain('--dfg-container-orbit:');
    expect(css).toContain('--dfg-container-orbit-compact:');
    expect(css).toContain('[class*="-hero-v"]');
    expect(css).toContain('[class*="-card-v"]');
    expect(css).toContain('.workspace-section-v133');
    expect(css).toContain('.admin-table-wrap-v14');
    expect(css).toContain('.contact-panel-v14');
    expect(css).toContain('background-image: var(--dfg-container-orbit) !important;');
  });

  it('keeps the Rewards marketplace composition aligned with the visual system', () => {
    expect(css).toContain('DadoFit V15.9.4 — Rewards marketplace composition');
    expect(css).toContain('.rewards-page-v15 .social-summary-stats-v112');
    expect(css).toContain('grid-template-columns: repeat(7, minmax(0, 1fr)) !important;');
    expect(css).toContain('.rewards-page-v15 .marketplace-destinations button.active');
    expect(css).toContain('.rewards-page-v15 .rewards-toolbar-v15');
    expect(css).toContain('.rewards-page-v15 .rewards-empty-v15');
    expect(rewardsMarketplace).toContain('<AlertCircle aria-hidden="true" />');
  });

  it('audits the five core personal routes as one visual family', () => {
    expect(css).toContain('DadoFit V15.9.5 — Core personal routes audit');
    expect(css).toContain('.workout-layout .result-card');
    expect(css).toContain('.challenges-topline-v10,');
    expect(css).toContain('.gymbros-topline-v9,');
    expect(css).toContain('.organizations-topline-v12');
    expect(css).toContain('.challenges-page-v10 .challenge-tabs-v10');
    expect(css).toContain('.gymbros-page-v9 .gymbro-row-v9');
    expect(css).toContain('.organizations-page-v12 .organization-member-row-v12');
    expect(organizationsPage).toContain('DADOFIT · ORGANIZACIONES');
    expect(organizationsPage).toContain('<h1>Organizaciones</h1>');
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

  it('keeps operational workspace routes free of advertising rails', () => {
    for (const route of ['/workspace', '/rewards/manage', '/rewards/analytics', '/rewards/validate']) {
      const routeLine = app.split(/\r?\n/).find((line) => line.includes(`path="${route}"`));
      expect(routeLine).toBeDefined();
      expect(routeLine).not.toContain('MonetizedPageShell');
    }
  });

  it('monetizes personal training but keeps Gym training ad-free', () => {
    expect(workout).toContain("activeWorkspace.kind === 'personal'");
    expect(workout).toContain('{personalWorkspace && <AdRail side="left" />}');
    expect(workout).toContain('{personalWorkspace && <AdRail side="right" />}');
    expect(workout).toContain('workout-operational-v1591');
    expect(finalCss).toContain('.monetized-page-v8.workout-operational-v1591');
    expect(finalCss).toContain('grid-template-columns: none !important;');
  });

  it('keeps Gym operations ad-free while personal organization pages remain monetized', () => {
    const organizations = app.split(/\r?\n/).find((line) => line.includes('path="/organizations"'));
    const challenges = app.split(/\r?\n/).find((line) => line.includes('path="/organization-challenges"'));
    const battles = app.split(/\r?\n/).find((line) => line.includes('path="/gym-battles"'));
    const seasons = app.split(/\r?\n/).find((line) => line.includes('path="/seasons"'));
    expect(organizations).toContain('<MonetizedPageShell>');
    expect(organizations).not.toContain("workspaceKinds={['personal','gym']}");
    expect(challenges).toContain('<MonetizedPageShell>');
    expect(challenges).not.toContain("workspaceKinds={['personal','gym']}");
    expect(battles).not.toContain('MonetizedPageShell');
    expect(seasons).toContain("<MonetizedPageShell workspaceKinds={['personal']}> ".trim());
    expect(seasons).not.toContain("workspaceKinds={['personal','gym']}");
  });

  it('homologates organization controls by semantic role', () => {
    expect(finalCss).toContain('.organizations-shell-v12 .organization-icon-action-v12');
    expect(finalCss).toContain('.organizations-shell-v12 .organization-member-actions-v12 select');
    expect(finalCss).toContain('.organizations-shell-v12 .organization-invite-gymbros-v12 button');
    expect(finalCss).toContain('.organizations-shell-v12 .organization-leave-v12');
    expect(finalCss).toContain('.organizations-shell-v12 .organization-create-v12 .profile-primary-v9');
  });

  it('uses real Gym challenge copy without legacy pseudo duplication', () => {
    expect(finalCss).toContain('.organization-challenges-page-v12 .organizations-hero-v12 h1::after');
    expect(finalCss).toContain('.organization-challenges-page-v12 .organizations-topline-v12 > .profile-back-v9');
    expect(organizationChallenges).toContain('activeWorkspace.kind === "personal"');
    expect(finalCss).toContain('.challenge-center-shell-v1577:empty');
  });

  it('keeps Gym battle navigation and hero on the operational visual contract', () => {
    expect(gymBattles).toContain('to="/workspace"');
    expect(gymBattles).toContain('Dashboard del Gym');
    expect(finalCss).toContain('.gym-battles-shell-v121 .gym-battles-page-v121');
    expect(finalCss).toContain('.gym-battles-shell-v121 .gym-battles-topline-v121 > .profile-back-v9');
    expect(finalCss).toContain('.gym-battles-shell-v121 .gym-battles-hero-stats-v121 > span');
  });

  it('defines shared dark action roles for legacy feature controls', () => {
    const secondary = [
      '.notifications-page-v113 .notifications-mark-all-v113',
      '.challenges-page-v10 .challenge-tabs-v10 button:not(.active)',
      '.squads-page-v11 .squad-invitations-v11 button.secondary',
      '.gym-battles-shell-v121 .gym-battle-tabs-v121 button:not(.active)',
      '.gymbros-page-v9 .gymbro-row-actions-v9 button.secondary',
      '.rewards-page-v15 .reward-validator-v152 > header button',
      '.brand-competition-shell-v157 .brand-competition-card-actions-v157 > button',
    ];
    const primary = [
      '.challenges-page-v10 .challenge-submit-v10',
      '.squads-page-v11 .squad-participant-actions-v11 button.primary',
      '.gym-battles-shell-v121 .gym-battle-submit-v121',
      '.business-setup-shell-v122 .business-setup-form-v122 button',
    ];
    const destructive = [
      '.challenges-page-v10 .challenge-evidence-remove-v10',
      '.organization-challenges-page-v12 .organization-review-v12 button.reject',
      '.squads-page-v11 .squad-leave-v11',
      '.gym-battles-shell-v121 .gym-battle-review-v121 button.reject',
      '.brand-audit-shell-v133 .audit-reject-v133',
    ];
    for (const selector of [...secondary, ...primary, ...destructive]) expect(finalCss).toContain(selector);
  });

  it('keeps brand back links visually separate from action buttons', () => {
    expect(finalCss).toContain('.brand-campaigns-shell-v13 .brand-campaigns-page-v13');
    expect(finalCss).toContain('.brand-competition-shell-v157 .brand-competition-page-v157');
    expect(finalCss).toContain('.brand-audit-shell-v133 .brand-audit-page-v133');
    expect(finalCss).toContain('background-image: none !important;');
    expect(finalCss).toContain('.brand-campaigns-shell-v13 .brand-topline-v13,');
    expect(finalCss).toContain('.brand-campaigns-shell-v13 .brand-topline-v13 > .profile-back-v9');
    expect(finalCss).toContain('.sponsored-shell-v13 .brand-topline-v13 > .profile-back-v9');
  });

  it('keeps the workspace hero on the canonical hero geometry', () => {
    expect(finalCss).toContain('.workspace-shell-v122 .workspace-home-v122.workspace-home-v133');
    expect(finalCss).toContain('padding-left: 0 !important;');
    expect(finalCss).toContain('padding-right: 0 !important;');
    expect(finalCss).toContain('.workspace-shell-v122 .workspace-section-v133');
    expect(finalCss).toContain('.workspace-shell-v122 .workspace-hero-v122.workspace-hero-v133');
    expect(finalCss).toContain('grid-template-columns: 58px minmax(0, 1fr) auto;');
    expect(finalCss).toContain('.workspace-shell-v122 .workspace-hero-icon-v122');
    expect(finalCss).toContain('.workspace-shell-v122 .workspace-verification-pill-v133.verified');
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
