import type { ReactNode } from 'react';
import { useWorkspace, type WorkspaceKind } from '../context/WorkspaceContext';
import { AdRail } from './AdRail';

interface Props {
  children: ReactNode;
  /** Backward-compatible flag used by older routes. */
  personalOnly?: boolean;
  /** Explicit workspace audiences that should receive ads on this route. */
  workspaceKinds?: WorkspaceKind[];
}

/**
 * Reusable monetization shell for DadoFit personal pages.
 *
 * Wide desktop keeps the six vertical placements. V14.6 lets those same paid
 * campaigns follow the audience into compact desktop/tablet and mobile, so a
 * resize never creates a commercial dead zone.
 */
export function MonetizedPageShell({ children, personalOnly = true, workspaceKinds }: Props) {
  const { activeWorkspace } = useWorkspace();
  const enabled = workspaceKinds
    ? workspaceKinds.includes(activeWorkspace.kind)
    : (!personalOnly || activeWorkspace.kind === 'personal');

  if (!enabled) return <>{children}</>;

  return (
    <div className="workout-layout monetized-network-shell-v142">
      <div className="monetized-page-v8 monetized-network-page-v142">
        <AdRail side="left"/>
        <div className="workout-center-v8 monetized-network-center-v142">{children}</div>
        <AdRail side="right" includeMobile={false}/>
      </div>
    </div>
  );
}
