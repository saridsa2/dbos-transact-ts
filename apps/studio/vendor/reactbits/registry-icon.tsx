import type { ComponentType, SVGProps } from 'react';
/** Maps registry icon slots to the application's existing Font Awesome Pro components. */
export function RegistryIcon({
  icon: Icon,
  size = 16,
  strokeWidth: _strokeWidth,
  ...props
}: SVGProps<SVGSVGElement> & { icon: ComponentType<SVGProps<SVGSVGElement>>; size?: number }) {
  return <Icon {...props} style={{ width: size, height: size, ...props.style }} />;
}
