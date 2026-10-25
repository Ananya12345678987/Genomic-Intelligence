import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import clsx from 'clsx';
import { BrandLockup, BrandMark } from './BrandMark';
import { StatusPill } from './StatusPill';
import { InvestigationList } from './InvestigationList';
import { UserMenu } from './UserMenu';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  onNewInvestigation: () => void;
  activeId?: string;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
}

export function Sidebar({ collapsed, onToggle, onNewInvestigation, activeId, onOpen, onDeleted }: Props) {
  return (
    <aside
      className={clsx(
        'flex h-full shrink-0 flex-col border-r border-line bg-surface-alt transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-72',
      )}
      aria-label="Investigations"
    >
      <div className={clsx('flex items-center p-3', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? <BrandMark /> : <BrandLockup />}
        {!collapsed && (
          <button className="btn !p-1.5" onClick={onToggle} aria-label="Collapse sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center pb-2">
          <button className="btn !p-1.5" onClick={onToggle} aria-label="Expand sidebar">
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="px-3">
        <button
          className={clsx('btn btn-primary w-full', collapsed && '!px-0')}
          onClick={onNewInvestigation}
          aria-label="New investigation"
        >
          <Plus className="h-4 w-4" />
          {!collapsed && 'New investigation'}
        </button>
      </div>

      {!collapsed ? <InvestigationList activeId={activeId} onOpen={onOpen} onDeleted={onDeleted} /> : <div className="flex-1" />}

      <div className="space-y-2 border-t border-line p-3">
        {!collapsed && <StatusPill />}
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
