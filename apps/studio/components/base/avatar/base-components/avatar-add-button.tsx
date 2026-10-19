'use client';

import { Plus } from '@/components/fa-icons';
import type { ButtonProps as AriaButtonProps } from 'react-aria-components';
import { Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from '@/components/base/tooltip/tooltip';
import { cx } from '@/utils/cx';

const sizes = {
  xs: { root: 'size-6', icon: 'size-4' },
  sm: { root: 'size-8', icon: 'size-4' },
  md: { root: 'size-10', icon: 'size-5' },
};

interface AvatarAddButtonProps extends AriaButtonProps {
  size: 'xs' | 'sm' | 'md';
  title?: string;
  className?: string;
}

export const AvatarAddButton = ({ size, className, title = 'Add user', ...props }: AvatarAddButtonProps) => (
  <AriaTooltip title={title}>
    <AriaTooltipTrigger
      {...props}
      aria-label={title}
      className={cx(
        'flex cursor-pointer items-center justify-center rounded-full border border-dashed border-ui-border-color-primary bg-ui-background-color-primary text-ui-color-fg-quaternary outline-ui-color-focus-ring transition duration-100 ease-linear hover:bg-ui-background-color-primary_hover hover:text-ui-color-fg-quaternary_hover focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
        sizes[size].root,
        className,
      )}
    >
      <Plus className={cx('text-current transition-inherit-all', sizes[size].icon)} />
    </AriaTooltipTrigger>
  </AriaTooltip>
);
