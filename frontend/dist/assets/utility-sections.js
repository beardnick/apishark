export function isUtilitySectionExpanded(button) {
    return button.getAttribute("aria-expanded") === "true";
}
export function setUtilitySectionExpanded(button, panel, expanded) {
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    panel.hidden = !expanded;
    panel.classList.toggle("is-expanded", expanded);
}
export function bindUtilitySectionToggle(button, panel) {
    setUtilitySectionExpanded(button, panel, isUtilitySectionExpanded(button));
    button.addEventListener("click", () => {
        setUtilitySectionExpanded(button, panel, !isUtilitySectionExpanded(button));
    });
}
export function setupUtilitySections(root = document) {
    const buttons = root.querySelectorAll("[data-utility-toggle]");
    for (const button of buttons) {
        const panelId = button.getAttribute("aria-controls");
        if (!panelId) {
            continue;
        }
        const panel = root.querySelector(`#${CSS.escape(panelId)}[data-utility-panel]`);
        if (!panel) {
            continue;
        }
        bindUtilitySectionToggle(button, panel);
    }
}
