import styles from './swarm-icon.module.css';

export function SwarmIcon({ size = 18, active = false, className = '' }: { size?: number; active?: boolean; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 32 32" fill="currentColor" className={`${styles.mark} ${active ? styles.running : ''} ${className}`}>
      {[0, 120, 240].map((angle, index) => (
        <g key={angle} transform={`rotate(${angle} 16 16)`}>
          <path className={`${styles.segment} ${styles[`segment${index}`]}`} d="M16 3.5 26.8 9.75 24.85 10.88 16 5.75 7.15 10.88 5.2 9.75Z"/>
        </g>
      ))}
      <path className={styles.core} d="m14.9 13.75 2.2-1.27v6.4l-2.2 1.27z"/>
    </svg>
  );
}
