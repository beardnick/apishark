export const DEFAULT_UTILITY_SIDEBAR_COLLAPSED = true;

type UtilitySidebarRootTarget = {
  setAttribute(name: string, value: string): void;
};

type UtilitySidebarTarget = {
  hidden: boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

export function normalizeUtilitySidebarCollapsed(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_UTILITY_SIDEBAR_COLLAPSED;
}

export function applyUtilitySidebarCollapsedState(
  root: UtilitySidebarRootTarget,
  sidebar: UtilitySidebarTarget,
  collapsed: boolean,
): void {
  root.setAttribute("data-utilities-collapsed", collapsed ? "true" : "false");
  sidebar.hidden = collapsed;
  if (collapsed) {
    sidebar.setAttribute("aria-hidden", "true");
  } else {
    sidebar.removeAttribute("aria-hidden");
  }
}
