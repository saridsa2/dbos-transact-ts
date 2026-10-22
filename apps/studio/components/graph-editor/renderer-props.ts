import type { ComponentProps } from 'react';
import type { BoardNode, EdgeLayer } from './elements';
/** Shared interaction contracts; each domain owns its rendering tree. */
export type DiagramNodeProps = Omit<ComponentProps<typeof BoardNode>, 'node' | 'readOnly'>;
export type DiagramEdgeProps = Omit<ComponentProps<typeof EdgeLayer>, 'nodes' | 'edges' | 'routing' | 'readOnly'>;

export type DiagramSurfaceProps = Omit<ComponentProps<typeof import('./graph-surface').GraphSurface>, 'children'> & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};
