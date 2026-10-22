'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useUnsavedNavigation } from '@/components/control/unsaved-changes';
import { useEventCallback } from 'usehooks-ts';
export type ControlTab = 'overview' | 'connections' | 'team' | 'runs' | 'audit' | 'identity' | 'keys';
export function useControlNavigation() {
  const pathname = usePathname(),
    search = useSearchParams(),
    router = useRouter();
  const guard = useUnsavedNavigation();
  const raw = search.get('tab');
  const tab: ControlTab = ['connections', 'team', 'runs', 'audit', 'identity', 'keys'].includes(raw ?? '')
    ? (raw as ControlTab)
    : 'overview';
  const navigate = useEventCallback((next: ControlTab) =>
    guard(() => router.push(next === 'overview' ? '/control' : `/control?tab=${next}`)),
  );
  return { pathname, tab, navigate };
}
