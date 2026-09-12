import type { SVGProps } from 'react';

/** 统一线性图标：24x24，stroke 使用 currentColor */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="M9.5 21v-6h5v6" />
  </Svg>
);

export const IconLedger = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);

export const IconChore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 4 9.5 12.5" />
    <path d="M12.5 9.5 8 16" />
    <path d="m14 7 4.5 6.5" />
    <path d="M15 14h5v5h-5z" />
    <path d="M4 19h7" />
  </Svg>
);

export const IconSupply = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z" />
    <path d="m3 8.5 9 4.5 9-4.5M12 13v7" />
  </Svg>
);

export const IconNest = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 7.5a3 3 0 0 1 0 5.5" />
    <path d="M17.5 14.5A5 5 0 0 1 21 19" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5 21 19H3z" />
    <path d="M12 10v4M12 16.5v.5" />
  </Svg>
);

export const IconSwap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h13l-3.5-3.5" />
    <path d="M20 16H7l3.5 3.5" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6 8.5 12l6 6" />
  </Svg>
);

export const IconRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Svg>
);

export const IconReset = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v10" />
    <path d="M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </Svg>
);

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19h14" />
    <path d="M15.5 5.5 18.5 8.5 9 18H6v-3z" />
  </Svg>
);

export const IconDoc = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4" />
    <path d="M10 12h5M10 16h5" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 7h14" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7l1 13h10l1-13" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.5" />
  </Svg>
);
