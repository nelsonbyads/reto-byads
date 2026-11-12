import { type MouseEvent } from 'react';
import { Link, useNavigate, type LinkProps } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';

interface Props extends LinkProps {
  workspaceId?: string | null;
}

export function WorkspaceActionLink({ workspaceId, onClick, to, target, ...props }: Props) {
  const navigate = useNavigate();
  const { selectWorkspace } = useWorkspace();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      !workspaceId ||
      target === '_blank' ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;

    event.preventDefault();
    selectWorkspace(workspaceId);
    navigate(to);
  };

  return <Link {...props} to={to} target={target} onClick={handleClick}/>;
}
