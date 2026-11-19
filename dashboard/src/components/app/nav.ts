import { FolderGit2, Gauge, Server, Coins, type LucideIcon } from 'lucide-react';

/** Sidebar navigation: one entry per section. */
export type NavKey = 'overview' | 'projects' | 'usage' | 'hosts';
export interface NavItem { key: NavKey; label: string; href: string; icon: LucideIcon }

export const NAV: NavItem[] = [
  { key: 'overview', label: 'Overview', href: '/', icon: Gauge },
  { key: 'projects', label: 'Projects', href: '/projects', icon: FolderGit2 },
  { key: 'usage', label: 'Usage', href: '/usage', icon: Coins },
  { key: 'hosts', label: 'Hosts', href: '/hosts', icon: Server },
];

export const navItem = (key: NavKey): NavItem => NAV.find((n) => n.key === key)!;
