import { Building2, ChevronDown, ShieldCheck, Tag, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace, workspaceHome, type WorkspaceOption } from '../context/WorkspaceContext';

function WorkspaceIcon({ workspace }: { workspace: WorkspaceOption }) {
  if (workspace.kind === 'gym') return <Building2 size={16}/>;
  if (workspace.kind === 'brand') return <Tag size={16}/>;
  return <UserRound size={16}/>;
}

function roleLabel(role: WorkspaceOption['role']) {
  if (!role) return 'Personal';
  const labels = { owner: 'Owner', admin: 'Admin', coach: 'Coach', member: 'Member' } as const;
  return labels[role];
}

export function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const { activeWorkspace, workspaces, selectWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);

  const choose = (workspace: WorkspaceOption) => {
    selectWorkspace(workspace.id);
    setOpen(false);
    navigate(workspaceHome(workspace));
  };

  return (
    <div className="workspace-switcher-v122">
      <button type="button" className="workspace-trigger-v122" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <WorkspaceIcon workspace={activeWorkspace}/>
        <span><strong>{activeWorkspace.label}</strong><small>{roleLabel(activeWorkspace.role)}</small></span>
        <ChevronDown size={14}/>
      </button>

      {open && (
        <div className="workspace-menu-v122">
          <div className="workspace-menu-title-v122"><ShieldCheck size={14}/><span>Usar DadoFit como</span></div>
          {workspaces.map((workspace) => (
            <button key={workspace.id} type="button" className={workspace.id === activeWorkspace.id ? 'active' : ''} onClick={() => choose(workspace)}>
              <WorkspaceIcon workspace={workspace}/>
              <span><strong>{workspace.label}</strong><small>{workspace.kind === 'personal' ? 'Perfil personal' : `${roleLabel(workspace.role)} · ${workspace.verificationStatus ?? 'active'}`}</small></span>
              {workspace.id === activeWorkspace.id && <i/>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
