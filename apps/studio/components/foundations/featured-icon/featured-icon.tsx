import type { FC, ReactNode, Ref } from 'react';
import { isValidElement } from 'react';
import { cx, sortCx } from '@/utils/cx';
import { isReactComponent } from '@/utils/is-react-component';

const iconsSizes = {
  sm: '*:data-icon:size-4 *:data-icon:stroke-[2.25px]',
  md: '*:data-icon:size-5',
  lg: '*:data-icon:size-6',
  xl: '*:data-icon:size-7',
};

const styles = sortCx({
  light: {
    base: 'rounded-full',
    sizes: {
      sm: 'size-8',
      md: 'size-10',
      lg: 'size-12',
      xl: 'size-14',
    },
    colors: {
      brand: 'bg-ui-background-color-brand-secondary text-ui-color-featured-icon-light-fg-brand',
      gray: 'bg-ui-background-color-tertiary text-ui-color-featured-icon-light-fg-gray',
      error: 'bg-ui-background-color-error-secondary text-ui-color-featured-icon-light-fg-error',
      warning: 'bg-ui-background-color-warning-secondary text-ui-color-featured-icon-light-fg-warning',
      success: 'bg-ui-background-color-success-secondary text-ui-color-featured-icon-light-fg-success',
    },
  },

  gradient: {
    base: 'rounded-full text-ui-color-fg-white before:absolute before:inset-0 before:size-full before:rounded-full before:border before:mask-b-from-0% after:absolute after:block after:rounded-full',
    sizes: {
      sm: 'size-8 after:size-6 *:data-icon:size-4',
      md: 'size-10 after:size-7 *:data-icon:size-4',
      lg: 'size-12 after:size-8 *:data-icon:size-5',
      xl: 'size-14 after:size-10 *:data-icon:size-5',
    },
    colors: {
      brand:
        'before:border-ui-color-utility-brand-200 before:bg-ui-color-utility-brand-50 after:bg-ui-background-color-brand-solid',
      gray: 'before:border-ui-color-utility-neutral-200 before:bg-ui-color-utility-neutral-50 after:bg-ui-background-color-secondary-solid',
      error:
        'before:border-ui-color-utility-red-200 before:bg-ui-color-utility-red-50 after:bg-ui-background-color-error-solid',
      warning:
        'before:border-ui-color-utility-yellow-200 before:bg-ui-color-utility-yellow-50 after:bg-ui-background-color-warning-solid',
      success:
        'before:border-ui-color-utility-green-200 before:bg-ui-color-utility-green-50 after:bg-ui-background-color-success-solid',
    },
  },

  dark: {
    base: 'text-ui-color-fg-white shadow-xs-skeuomorphic before:absolute before:inset-px before:border before:border-white/12 before:mask-b-from-0%',
    sizes: {
      sm: 'size-8 rounded-md before:rounded-[5px]',
      md: 'size-10 rounded-lg before:rounded-[7px]',
      lg: 'size-12 rounded-[10px] before:rounded-[9px]',
      xl: 'size-14 rounded-xl before:rounded-[11px]',
    },
    colors: {
      brand: 'bg-ui-background-color-brand-solid before:border-ui-color-utility-brand-200/12',
      gray: 'bg-ui-background-color-secondary-solid before:border-ui-color-utility-neutral-200/12',
      error: 'bg-ui-background-color-error-solid before:border-ui-color-utility-red-200/12',
      warning: 'bg-ui-background-color-warning-solid before:border-ui-color-utility-yellow-200/12',
      success: 'bg-ui-background-color-success-solid before:border-ui-color-utility-green-200/12',
    },
  },

  modern: {
    base: 'bg-ui-background-color-primary shadow-xs-skeuomorphic ring-1 ring-ui-ring-color-primary ring-inset',
    sizes: {
      sm: 'size-8 rounded-md',
      md: 'size-10 rounded-lg',
      lg: 'size-12 rounded-[10px]',
      xl: 'size-14 rounded-xl',
    },
    colors: {
      brand: 'text-ui-color-fg-brand-primary',
      gray: 'text-ui-color-fg-secondary',
      error: 'text-ui-color-fg-error-primary',
      warning: 'text-ui-color-fg-warning-primary',
      success: 'text-ui-color-fg-success-primary',
    },
  },
  'modern-neue': {
    base: [
      'bg-ui-background-color-primary_alt ring-1 ring-inset before:absolute before:inset-1',
      // Shadow
      'before:shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1),0px_3px_3px_0px_rgba(0,0,0,0.09),1px_8px_5px_0px_rgba(0,0,0,0.05),2px_21px_6px_0px_rgba(0,0,0,0),0px_0px_0px_1px_rgba(0,0,0,0.08),1px_13px_5px_0px_rgba(0,0,0,0.01),0px_-2px_2px_0px_rgba(0,0,0,0.13)_inset] before:ring-1 before:ring-ui-ring-color-secondary_alt',
    ].join(' '),
    sizes: {
      sm: 'size-8 rounded-[8px] before:rounded-[4px]',
      md: 'size-10 rounded-[10px] before:rounded-[6px]',
      lg: 'size-12 rounded-[12px] before:rounded-[8px]',
      xl: 'size-14 rounded-[14px] before:rounded-[10px]',
    },
    colors: {
      brand: '',
      gray: 'text-ui-color-fg-secondary ring-ui-ring-color-primary',
      error: '',
      warning: '',
      success: '',
    },
  },

  outline: {
    base: 'before:absolute before:rounded-full before:border-2 after:absolute after:rounded-full after:border-2',
    sizes: {
      sm: 'size-4 before:size-6 after:size-8.5',
      md: 'size-5 before:size-7 after:size-9.5',
      lg: 'size-6 before:size-8 after:size-10.5',
      xl: 'size-7 before:size-9 after:size-11.5',
    },
    colors: {
      brand:
        'text-ui-color-fg-brand-primary before:border-ui-color-fg-brand-primary/30 after:border-ui-color-fg-brand-primary/10',
      gray: 'text-ui-color-fg-tertiary before:border-ui-color-fg-tertiary/30 after:border-ui-color-fg-tertiary/10',
      error:
        'text-ui-color-fg-error-primary before:border-ui-color-fg-error-primary/30 after:border-ui-color-fg-error-primary/10',
      warning:
        'text-ui-color-fg-warning-primary before:border-ui-color-fg-warning-primary/30 after:border-ui-color-fg-warning-primary/10',
      success:
        'text-ui-color-fg-success-primary before:border-ui-color-fg-success-primary/30 after:border-ui-color-fg-success-primary/10',
    },
  },
});

interface FeaturedIconProps {
  /** A ref to the wrapper element. */
  ref?: Ref<HTMLDivElement>;
  /** Extra content rendered inside the wrapper, alongside the icon. */
  children?: ReactNode;
  /** The class name applied to the wrapper. */
  className?: string;
  /** The icon to display. Accepts a component reference or a rendered element. */
  icon?: FC<{ className?: string }> | ReactNode;
  /** Controls the dimensions of the wrapper and the icon inside it. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** The semantic color used for the background, icon and border of the current theme. The `modern` and `modern-neue` themes are only styled for `gray`. */
  color: 'brand' | 'gray' | 'success' | 'warning' | 'error';
  /** The visual treatment of the icon container, from a subtle tinted circle to a solid, outlined or skeuomorphic surface. */
  theme?: 'light' | 'gradient' | 'dark' | 'outline' | 'modern' | 'modern-neue';
}

export const FeaturedIcon = (props: FeaturedIconProps) => {
  const { size = 'sm', theme: variant = 'light', color = 'brand', icon: Icon, ...otherProps } = props;

  return (
    <div
      {...otherProps}
      data-featured-icon
      className={cx(
        'relative flex shrink-0 items-center justify-center',

        iconsSizes[size],
        styles[variant].base,
        styles[variant].sizes[size],
        styles[variant].colors[color],

        props.className,
      )}
    >
      {isReactComponent(Icon) && <Icon data-icon className="z-1" />}
      {isValidElement(Icon) && <div className="z-1">{Icon}</div>}

      {props.children}
    </div>
  );
};
