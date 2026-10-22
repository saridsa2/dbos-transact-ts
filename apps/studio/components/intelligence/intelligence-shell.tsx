'use client';
/** Workspace composition of the licensed App Sidebar and Chat Layout, without a second navigation primitive. */
import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppSidebar } from '@/vendor/aisdkagents/app-sidebar';
import { ChatLayout, useChatLayout } from '@/vendor/aisdkagents/chat-layout';
import { useUnsavedNavigation } from '@/components/control/unsaved-changes';
import { useControl } from '@/components/control/access';
import { StackProcLogo } from '@/components/control/stackproc-logo';
import { ControlButton } from '@/components/control/controls';
import {
  ChartIcon,
  TimerIcon,
  LayersIcon,
  AgentIcon,
  SettingsIcon,
  MenuIcon,
  ArrowRightIcon,
} from '@/components/fa-icons';

export const intelligenceDestinations = [
  { id: 'overview', label: 'Overview', icon: <ChartIcon /> },
  { id: 'activities', label: 'Activities', icon: <TimerIcon /> },
  { id: 'suggestions', label: 'Suggestions', icon: <LayersIcon /> },
  { id: 'agents', label: 'Agents', icon: <AgentIcon /> },
  { id: 'memory', label: 'Memory', icon: <LayersIcon /> },
  { id: 'setup', label: 'Workspace setup', icon: <SettingsIcon /> },
];
export function IntelligenceSidebarToggle() {
  const layout = useChatLayout();
  return layout.compact ? (
    <ControlButton aria-label="Open intelligence navigation" iconLeading={MenuIcon} onPress={layout.toggleSidebar} />
  ) : null;
}
export function IntelligenceShell({
  view,
  children,
  history,
  onNewInstruction,
  onPolicy,
  pendingSuggestions,
}: {
  view: string;
  children: ReactNode;
  history?: ReactNode;
  onNewInstruction?: () => void;
  onPolicy?: () => void;
  pendingSuggestions?: number;
}) {
  const router = useRouter();
  const navigate = useUnsavedNavigation();
  const { session } = useControl();
  const [open, setOpen] = useState(true);
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  return (
    <div className="wi-workspace wi-shell wi-lifecycle">
      <ChatLayout
        compactBelow={1024}
        sidebarOpen={open}
        onSidebarOpenChange={setOpen}
        sidebarWidth={264}
        sidebarClosedWidth={48}
        onCompactChange={(value) => {
          compactRef.current = value;
          setCompact(value);
          setOpen(!value);
        }}
        panelOpen={false}
        classNames={{ root: 'wi-navigation-layout', sidebar: 'wi-navigation-pane', main: 'wi-navigation-main' }}
        sidebar={
          <AppSidebar
            name="Intelligence"
            label="Workspace intelligence navigation"
            brand={<StackProcLogo />}
            collapsed={!open && !compact}
            onToggle={() => setOpen(!open)}
            onNewChat={() =>
              navigate(() => {
                if (onNewInstruction) onNewInstruction();
                else router.push('/intelligence?view=conversation');
                if (compactRef.current) setOpen(false);
              })
            }
            newChatLabel="New activity"
            items={intelligenceDestinations.map((item) => ({
              ...item,
              badge: item.id === 'suggestions' && pendingSuggestions ? pendingSuggestions : undefined,
            }))}
            activeItem={view === 'conversation' ? 'activities' : view}
            onNavigate={(id) => {
              navigate(() => router.push(`/intelligence?view=${id}`));
              if (compactRef.current) setOpen(false);
            }}
            account={{ name: session.user?.displayName ?? 'Workspace member', detail: session.workspace?.name }}
            footer={
              <div className="wi-navigation-footer">
                {onPolicy && (
                  <ControlButton aria-label="Workspace policy" iconLeading={SettingsIcon} onPress={onPolicy}>
                    {open ? 'Workspace policy' : null}
                  </ControlButton>
                )}
                <ControlButton
                  aria-label="Return to workspace"
                  iconLeading={ArrowRightIcon}
                  onPress={() => navigate(() => router.push('/'))}
                >
                  {open ? 'Workspace' : null}
                </ControlButton>
              </div>
            }
            classNames={{ root: 'wi-app-sidebar', row: 'wi-navigation-row' }}
          >
            {/* Activity history is contextual, not global navigation. */}
          </AppSidebar>
        }
      >
        {children}
      </ChatLayout>
    </div>
  );
}
