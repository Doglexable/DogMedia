// Lucide-style platform glyphs for the exclusive-session connect bar.
//
// `lucide-react` is not a dependency of this workspace, so the three icons
// needed here (monitor, smartphone, globe) are inlined with exact Lucide path
// data (ISC licensed): 24x24 stroke grid, stroke="currentColor", width 2.

export function holderPlatformIconName(platform) {
  if (platform === "desktop") return "monitor";
  if (platform === "mobile") return "smartphone";
  return "globe";
}

function IconPaths({ name }) {
  if (name === "monitor") {
    return (
      <>
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </>
    );
  }
  if (name === "smartphone") {
    return (
      <>
        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </>
    );
  }
  return (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </>
  );
}

export default function HolderPlatformIcon({ platform, className = "" }) {
  const name = holderPlatformIconName(platform);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-lucide={name}
      className={className}
    >
      <IconPaths name={name} />
    </svg>
  );
}
