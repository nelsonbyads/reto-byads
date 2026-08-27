import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

export type SignupIntent = 'personal' | 'gym' | 'brand';
export type WorkspaceKind = 'personal' | 'gym' | 'brand';
export type OrganizationRole = 'owner' | 'admin' | 'coach' | 'member';

export interface WorkspaceOption {
  id: string;
  kind: WorkspaceKind;
  label: string;
  organizationId: string | null;
  organizationType: string | null;
  role: OrganizationRole | null;
  verificationStatus: string | null;
}

interface WorkspaceCapabilities {
  canCreateGym: boolean;
  canCreateBrand: boolean;
}

interface WorkspaceContextValue {
  loading: boolean;
  error: string;
  signupIntent: SignupIntent;
  capabilities: WorkspaceCapabilities;
  workspaces: WorkspaceOption[];
  activeWorkspace: WorkspaceOption;
  selectWorkspace: (workspaceId: string) => void;
  refresh: (preferredWorkspaceId?: string) => Promise<void>;
  needsBusinessSetup: boolean;
}

const PERSONAL_WORKSPACE: WorkspaceOption = {
  id: 'personal',
  kind: 'personal',
  label: 'Mi perfil',
  organizationId: null,
  organizationType: null,
  role: null,
  verificationStatus: null,
};

const EMPTY_CAPABILITIES: WorkspaceCapabilities = {
  canCreateGym: false,
  canCreateBrand: false,
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function storageKey(userId: string) {
  return `dadofit:workspace:v122:${userId}`;
}

function parseWorkspace(item: Record<string, unknown>): WorkspaceOption | null {
  const id = typeof item.id === 'string' ? item.id : '';
  const kind = item.kind === 'gym' || item.kind === 'brand' || item.kind === 'personal' ? item.kind : null;
  if (!id || !kind) return null;
  return {
    id,
    kind,
    label: typeof item.label === 'string' && item.label ? item.label : kind === 'personal' ? 'Mi perfil' : 'Workspace',
    organizationId: typeof item.organization_id === 'string' ? item.organization_id : null,
    organizationType: typeof item.organization_type === 'string' ? item.organization_type : null,
    role: item.role === 'owner' || item.role === 'admin' || item.role === 'coach' || item.role === 'member' ? item.role : null,
    verificationStatus: typeof item.verification_status === 'string' ? item.verification_status : null,
  };
}

export function workspaceHome(workspace: WorkspaceOption) {
  return workspace.kind === 'personal' ? '/app' : '/workspace';
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signupIntent, setSignupIntent] = useState<SignupIntent>('personal');
  const [capabilities, setCapabilities] = useState<WorkspaceCapabilities>(EMPTY_CAPABILITIES);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([PERSONAL_WORKSPACE]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceOption>(PERSONAL_WORKSPACE);

  const applyWorkspace = useCallback((next: WorkspaceOption, userId?: string) => {
    setActiveWorkspace(next);
    document.documentElement.dataset.dadofitWorkspace = next.kind;
    document.documentElement.dataset.dadofitWorkspaceId = next.id;
    if (userId) {
      try { localStorage.setItem(storageKey(userId), next.id); } catch { /* ignore */ }
    }
  }, []);

  const refresh = useCallback(async (preferredWorkspaceId?: string) => {
    if (!user || user.provider !== 'supabase' || !supabase) {
      setSignupIntent('personal');
      setCapabilities(EMPTY_CAPABILITIES);
      setWorkspaces([PERSONAL_WORKSPACE]);
      applyWorkspace(PERSONAL_WORKSPACE, user?.id);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('get_dadofit_workspace_context');
    if (rpcError) {
      setError(rpcError.message);
      setWorkspaces([PERSONAL_WORKSPACE]);
      applyWorkspace(PERSONAL_WORKSPACE, user.id);
      setLoading(false);
      return;
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    const rawIntent = payload.signup_intent;
    const nextIntent: SignupIntent = rawIntent === 'gym' || rawIntent === 'brand' ? rawIntent : 'personal';
    const rawCapabilities = (payload.capabilities ?? {}) as Record<string, unknown>;
    const nextCapabilities: WorkspaceCapabilities = {
      canCreateGym: Boolean(rawCapabilities.can_create_gym),
      canCreateBrand: Boolean(rawCapabilities.can_create_brand),
    };
    const rawWorkspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
    const parsed = rawWorkspaces
      .map((item) => parseWorkspace((item ?? {}) as Record<string, unknown>))
      .filter((item): item is WorkspaceOption => Boolean(item));
    const nextWorkspaces = parsed.some((item) => item.id === 'personal') ? parsed : [PERSONAL_WORKSPACE, ...parsed];

    let stored = preferredWorkspaceId ?? '';
    if (!stored) {
      try { stored = localStorage.getItem(storageKey(user.id)) ?? ''; } catch { stored = ''; }
    }
    const selected = nextWorkspaces.find((item) => item.id === stored) ?? PERSONAL_WORKSPACE;

    setSignupIntent(nextIntent);
    setCapabilities(nextCapabilities);
    setWorkspaces(nextWorkspaces);
    applyWorkspace(selected, user.id);
    setLoading(false);
  }, [applyWorkspace, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    const next = workspaces.find((item) => item.id === workspaceId);
    if (!next) return;
    applyWorkspace(next, user?.id);
  }, [applyWorkspace, user?.id, workspaces]);

  const needsBusinessSetup = useMemo(() => {
    if (signupIntent === 'gym') return capabilities.canCreateGym && !workspaces.some((item) => item.kind === 'gym');
    if (signupIntent === 'brand') return capabilities.canCreateBrand && !workspaces.some((item) => item.kind === 'brand');
    return false;
  }, [capabilities, signupIntent, workspaces]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    loading,
    error,
    signupIntent,
    capabilities,
    workspaces,
    activeWorkspace,
    selectWorkspace,
    refresh,
    needsBusinessSetup,
  }), [activeWorkspace, capabilities, error, loading, needsBusinessSetup, refresh, selectWorkspace, signupIntent, workspaces]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
