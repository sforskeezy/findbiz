import './pai-logo.css';
import type { CSSProperties } from 'react';

/**
 * The PAI lockup with a living map: the three folds of the icon unfold on load,
 * catch a light sweep, and flex when hovered. Geometry matches pai-logo-lockup.png
 * (wordmark 0–447px, icon 498–960px of a 960×321 canvas).
 */
export function PaiLogo({ height = 24, iconOnly = false, className = '' }: { height?: number; iconOnly?: boolean; className?: string }) {
  return <span className={`pai-logo ${className}`} style={{ '--h': `${height}px` } as CSSProperties} role="img" aria-label="PAI">
    {!iconOnly && <span className="pai-logo-word" aria-hidden="true"/>}
    <span className={`pai-logo-map ${iconOnly ? 'solo' : ''}`} aria-hidden="true">
      <span className="pai-fold pai-fold-1"/>
      <span className="pai-fold pai-fold-2"/>
      <span className="pai-fold pai-fold-3"/>
      <span className="pai-logo-sheen"/>
    </span>
  </span>;
}
