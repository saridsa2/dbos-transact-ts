'use client';
import {
  ProcessStartIcon,
  ProcessEndIcon,
  TimerIcon,
  MessageIcon,
  AgentIcon,
  RepeatIcon,
  ParallelIcon,
  MergeIcon,
  BranchIcon,
  DatabaseIcon,
  SettingsIcon,
  User01,
  WorkflowIcon,
  Bell,
} from '@/components/fa-icons';
import type { ProcessElement } from '@/lib/processes/model';
export function processIcon(element: ProcessElement) {
  if (element.kind === 'start') return ProcessStartIcon;
  if (element.kind === 'end') return ProcessEndIcon;
  if (element.kind === 'decision') return BranchIcon;
  if (element.kind === 'merge') return MergeIcon;
  const binding = element.binding;
  if (binding.kind === 'agent' || (binding.kind === 'requirement' && binding.performer === 'agent')) return AgentIcon;
  if (binding.kind === 'requirement') return binding.performer === 'human' ? User01 : SettingsIcon;
  if (binding.kind === 'construct') return DatabaseIcon;
  return (
    (
      {
        review: User01,
        delay: TimerIcon,
        receive: MessageIcon,
        waitEvent: Bell,
        workflow: WorkflowIcon,
        foreach: RepeatIcon,
        loop: RepeatIcon,
        parallel: ParallelIcon,
      } as Record<string, typeof TimerIcon>
    )[binding.operation.kind] ?? SettingsIcon
  );
}
