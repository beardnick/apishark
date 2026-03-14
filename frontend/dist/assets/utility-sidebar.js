export const DEFAULT_UTILITY_SIDEBAR_COLLAPSED = true;
export function normalizeUtilitySidebarCollapsed(value) {
    return typeof value === "boolean" ? value : DEFAULT_UTILITY_SIDEBAR_COLLAPSED;
}
export function applyUtilitySidebarCollapsedState(root, sidebar, toggle, label, collapsed) {
    const actionLabel = collapsed ? "Show utilities" : "Hide utilities";
    root.setAttribute("data-utilities-collapsed", collapsed ? "true" : "false");
    sidebar.hidden = collapsed;
    if (collapsed) {
        sidebar.setAttribute("aria-hidden", "true");
    }
    else {
        sidebar.removeAttribute("aria-hidden");
    }
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.ariaLabel = actionLabel;
    toggle.title = actionLabel;
    label.textContent = actionLabel;
}
