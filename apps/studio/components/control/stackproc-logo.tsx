import type { SVGProps } from 'react';
/** Original logo mark from stackproc-ai/components/logo.tsx. */
export function StackProcLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} aria-hidden="true" fill="currentColor" viewBox="0 0 60 45" xmlns="http://www.w3.org/2000/svg">
      <path
        clipRule="evenodd"
        fillRule="evenodd"
        d="M0 0H15V15H30V30H15V45H0V30V15V0ZM45 30V15H30V0H45H60V15V30V45H45H30V30H45Z"
      />
    </svg>
  );
}
