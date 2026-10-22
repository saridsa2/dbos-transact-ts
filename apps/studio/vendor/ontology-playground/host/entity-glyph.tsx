import { icon, type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faClipboard,
  faCartShopping,
  faCreditCard,
  faGlobe,
  faFolder,
  faBullseye,
  faBolt,
  faTag,
  faChartLine,
  faTruck,
  faReceipt,
  faMugHot,
  faCube,
  faUser,
  faBuilding,
  faDiagramProject,
  faLink,
  faDatabase,
  faLayerGroup,
  faWavePulse,
  faKey,
  faPen,
  faBell,
  faGear,
} from '@/lib/control/pro-icons';
const symbols: Record<string, IconDefinition> = {
  '👤': faUser,
  '🏢': faBuilding,
  '🏪': faBuilding,
  '🌐': faGlobe,
  '📋': faClipboard,
  '🛒': faCartShopping,
  '💳': faCreditCard,
  '📈': faChartLine,
  '🚚': faTruck,
  '🧾': faReceipt,
  '☕': faMugHot,
  '🔗': faLink,
  '📁': faFolder,
  '📊': faDatabase,
  '⚡': faBolt,
  '🎯': faBullseye,
  '📝': faPen,
  '🏷️': faTag,
  '🔧': faGear,
};
export function EntityGlyph({ symbol }: { symbol?: string }) {
  return (
    <FontAwesomeIcon icon={symbols[symbol ?? ''] ?? faCube} aria-hidden="true" style={{ width: 20, height: 20 }} />
  );
}
export function entityGlyphImage(symbol: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    icon(symbols[symbol] ?? faCube, { styles: { color: '#475467' } })
      .html.join('')
      .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="#475467" '),
  )}`;
}
