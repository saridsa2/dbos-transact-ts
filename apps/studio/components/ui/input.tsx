import type * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[background-color,border-color,box-shadow,transform,color] duration-200 ease-out selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
        'hover:border-[#c9d4c2] hover:bg-white focus-visible:-translate-y-px focus-visible:border-[#111411] focus-visible:ring-[3px] focus-visible:ring-[#8ef07f]/35',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
