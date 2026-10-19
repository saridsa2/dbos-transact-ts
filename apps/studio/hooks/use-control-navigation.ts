'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEventCallback } from 'usehooks-ts';
export type ControlTab = 'overview' | 'connections' | 'team' | 'runs' | 'audit' | 'identity';
export function useControlNavigation() {
  const pathname = usePathname(),
    search = useSearchParams(),
    router = useRouter();
  const raw = search.get('tab');
  const tab: ControlTab = ['connections', 'team', 'runs', 'audit', 'identity'].includes(raw ?? '')
    ? (raw as ControlTab)
    : 'overview';
  const navigate = useEventCallback((next: ControlTab) =>
    router.push(next === 'overview' ? '/control' : `/control?tab=${next}`),
  );
  return { pathname, tab, navigate };
}
