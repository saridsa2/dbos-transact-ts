import type { SVGProps } from 'react';

/** Procczar PC monogram. Export names retained for existing application consumers. */
export function StackProcLogo({ icon = false, ...props }: SVGProps<SVGSVGElement> & { icon?: boolean }) {
  return (
    <svg
      viewBox={icon ? '144 149 740 705' : '0 0 1024 1024'}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
      aria-hidden="true"
    >
      <title>Procczar — PC monogram</title>
      {!icon && <rect width="1024" height="1024" rx="184" fill="#FFFFFF" />}
      <path
        fill={icon ? 'currentColor' : '#24B9ED'}
        d="M160 770V252l87-87h362l90 87v80L519 512H297v-96h196l106-106-42-42H270v570h-38z"
      />
      <path
        fill={icon ? 'currentColor' : '#F5A000'}
        d="m544 524 170-170h85l69 69v90h-46l-46-46h-76l-57 57zM322 538h100v131l56 56h256l70-70h64v80l-94 94H435L322 716z"
      />
    </svg>
  );
}

/** Navigation glyph without a tile, inheriting the surrounding icon colour. */
export function StackProcIcon(props: SVGProps<SVGSVGElement>) {
  return <StackProcLogo {...props} icon />;
}
