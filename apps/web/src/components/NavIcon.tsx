export type NavIconName = 'games' | 'account';

/** Enkle strekikoner. Emoji ble ikke brukt, fordi ikke alle enheter har en emojifont. */
export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'games' ? (
        // d20
        <>
          <path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5Z" />
          <path d="M12 7.5 16.5 15h-9Z" />
          <path d="M12 2.5v5M3.5 7.25 7.5 15M20.5 7.25 16.5 15M3.5 16.75 7.5 15M20.5 16.75 16.5 15M12 21.5 7.5 15M12 21.5l4.5-6.5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="8.5" r="4" />
          <path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6" />
        </>
      )}
    </svg>
  );
}
