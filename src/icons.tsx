import type { ComponentChildren } from "preact";

function Icon({ children, size = 24 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const BackIcon = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);
export const SwapIcon = () => (
  <Icon>
    <path d="M8 4v14M8 18l-3-3M8 18l3-3M16 20V6M16 6l-3 3M16 6l3 3" />
  </Icon>
);
export const RefreshIcon = () => (
  <Icon>
    <path d="M20 11a8 8 0 0 0-14.3-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4l1.7-2M20 20v-5h-5" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
  </Icon>
);
export const PencilIcon = () => (
  <Icon size={20}>
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  </Icon>
);
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon size={20}>
    <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
  </Icon>
);

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"
        fill={filled ? "var(--star)" : "none"}
        stroke={filled ? "var(--star)" : "currentColor"}
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M9 7.5v9M15 7.5v9M9 12h6" fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  );
}

export const AddressIcon = () => (
  <Icon>
    <path d="M12 21s7-6.3 7-11.5a7 7 0 0 0-14 0C5 14.7 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);
