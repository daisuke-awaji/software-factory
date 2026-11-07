import type { ReactNode } from "react";

// アイコンの形は UI モック（ui-mock/src/shared/icons.tsx）から引き継いだ

/* 16px の線のアイコン（AffectUI の部品と同じ 1.6px の線） */
function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconPlus = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
export const IconSend = () => <Svg><path d="M12 19V5M6 11l6-6 6 6" /></Svg>;
export const IconCheck = () => <Svg><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
export const IconChevron = () => <Svg><path d="M9 6l6 6-6 6" /></Svg>;
export const IconBack = () => <Svg><path d="M15 6l-6 6 6 6" /></Svg>;
export const IconMenu = () => <Svg><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const IconChevronDown = () => <Svg><path d="M6 9l6 6 6-6" /></Svg>;
export const IconExternal = () => <Svg><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" /></Svg>;
export const IconRepo = () => <Svg><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5v-15zM5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5" /></Svg>;
export const IconBranch = () => <Svg><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 8v8M18 10c0 4-6 3-11.2 6.6" /></Svg>;
export const IconPR = () => <Svg><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 8v8M18 16V9a2 2 0 0 0-2-2h-5M13 5l-2 2 2 2" /></Svg>;
export const IconGlobe = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" /></Svg>;
export const IconDownload = () => <Svg><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>;
export const IconEye = () => <Svg><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Svg>;
export const IconBox = () => <Svg><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9" /></Svg>;
export const IconChat = () => <Svg><path d="M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-3 2.5z" /></Svg>;
export const IconList = () => <Svg><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></Svg>;
export const IconFile = () => <Svg><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5" /></Svg>;
export const IconSun = () => <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></Svg>;
export const IconMoon = () => <Svg><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Svg>;
export const IconClip = () => <Svg><path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7" /></Svg>;
export const IconSearch = () => <Svg><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></Svg>;
export const IconRefresh = () => <Svg><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4" /></Svg>;
export const IconTerminal = () => <Svg><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17" /></Svg>;
export const IconFactory = () => <Svg><path d="M3 20V10l5 3V10l5 3V10l5 3V5h3v15H3zM7 17h2M12 17h2M17 17h1" /></Svg>;
export const IconSidebar = () => <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Svg>;
export const IconCompose = () => <Svg><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 8.5-8.5z" /></Svg>;
export const IconPanel = () => <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></Svg>;
export const IconClose = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconFilter = () => <Svg><path d="M4 6h16M7 12h10M10 18h4" /></Svg>;
export const IconInbox = () => <Svg><path d="M3 13l3-8h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5zM3 13h5l1.5 2.5h5L16 13h5" /></Svg>;
export const IconHome = () => <Svg><path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-8.5z" /></Svg>;
export const IconSettings = () => <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;

export const IconStop = () => <Svg><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>;
export const IconShield = () => <Svg><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></Svg>;
export const IconBlock = () => <Svg><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></Svg>;
export const IconWarning = () => <Svg><path d="M12 4l9 16H3l9-16zM12 10v4M12 17h.01" /></Svg>;
export const IconLock = () => <Svg><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
export const IconMore = () => <Svg><circle cx="5.5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18.5" cy="12" r="1" /></Svg>;
export const IconFolder = () => <Svg><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></Svg>;
export const IconImage = () => <Svg><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M8 9.8l4 2.2 4-2.2" /></Svg>;
export const IconWorkflow = () => <Svg><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 12h3M14 12h3" /></Svg>;
export const IconUsers = () => <Svg><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></Svg>;
export const IconCopy = () => <Svg><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>;

/** ツールの種類ごとのアイコン（ToolCallCard の icon に渡す） */
export function toolIcon(name: string) {
  if (name === "read_file") return <IconFile />;
  if (name === "edit_file") return <IconFile />;
  if (name === "run") return <IconTerminal />;
  if (name === "browser") return <IconEye />;
  if (name === "review_diff") return <IconSearch />;
  if (name === "create_pull_request" || name === "git_push") return <IconPR />;
  if (name === "list_files") return <IconFolder />;
  if (name === "search") return <IconSearch />;
  if (name === "publish_precheck") return <IconShield />;
  return <IconBox />;
}
