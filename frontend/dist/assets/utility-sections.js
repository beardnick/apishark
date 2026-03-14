export function setUtilitySectionActive(button, panel, active) {
    button.setAttribute("aria-expanded", active ? "true" : "false");
    button.classList.toggle("is-active", active);
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
    if (active) {
        panel.removeAttribute?.("aria-hidden");
    }
    else {
        panel.setAttribute?.("aria-hidden", "true");
    }
}
export function createUtilitySectionController(entries, onToggle) {
    let activePanelId = null;
    const sync = () => {
        for (const entry of entries) {
            setUtilitySectionActive(entry.button, entry.panel, entry.panelId === activePanelId);
        }
    };
    const setActivePanel = (panelId) => {
        activePanelId = entries.some((entry) => entry.panelId === panelId) ? panelId : null;
        sync();
    };
    for (const entry of entries) {
        entry.button.addEventListener("click", () => {
            activePanelId = activePanelId === entry.panelId ? null : entry.panelId;
            sync();
            onToggle?.(activePanelId);
        });
    }
    sync();
    return {
        getActivePanelId: () => activePanelId,
        setActivePanel,
    };
}
export function setupUtilitySections(root = document, onToggle) {
    const entries = [];
    const buttons = root.querySelectorAll("[data-utility-rail]");
    for (const button of buttons) {
        const panelId = button.getAttribute("data-utility-target");
        if (!panelId) {
            continue;
        }
        const panel = root.querySelector(`#${CSS.escape(panelId)}[data-utility-panel]`);
        if (!panel) {
            continue;
        }
        entries.push({ button, panel, panelId });
    }
    return createUtilitySectionController(entries, onToggle);
}
