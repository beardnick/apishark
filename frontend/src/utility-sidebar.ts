export const DEFAULT_UTILITY_SIDEBAR_COLLAPSED = true;

type UtilitySidebarRootTarget = {
  setAttribute(name: string, value: string): void;
};

type UtilitySidebarTarget = {
  hidden: boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

type UtilitySidebarToggleTarget = {
  ariaLabel: string | null;
  title: string;
  setAttribute(name: string, value: string): void;
};

type UtilitySidebarLabelTarget = {
  textContent: string | null;
};

export function normalizeUtilitySidebarCollapsed(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_UTILITY_SIDEBAR_COLLAPSED;
}

export function applyUtilitySidebarCollapsedState(
  root: UtilitySidebarRootTarget,
  sidebar: UtilitySidebarTarget,
  toggle: UtilitySidebarToggleTarget,
  label: UtilitySidebarLabelTarget,
  collapsed: boolean,
): void {
  const actionLabel = collapsed ? "Show utilities" : "Hide utilities";

  root.setAttribute("data-utilities-collapsed", collapsed ? "true" : "false");
  sidebar.hidden = collapsed;
  if (collapsed) {
    sidebar.setAttribute("aria-hidden", "true");
  } else {
    sidebar.removeAttribute("aria-hidden");
  }
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggle.ariaLabel = actionLabel;
  toggle.title = actionLabel;
  label.textContent = actionLabel;
}
