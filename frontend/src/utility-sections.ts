type UtilityToggleTarget = {
  addEventListener(type: "click", listener: () => void): void;
  setAttribute(name: string, value: string): void;
  classList: {
    toggle(token: string, force?: boolean): void;
  };
};

type UtilityPanelTarget = {
  hidden: boolean;
  classList: {
    toggle(token: string, force?: boolean): void;
  };
};

type UtilitySectionEntry = {
  button: UtilityToggleTarget;
  panel: UtilityPanelTarget;
  panelId: string;
};

export type UtilitySectionController = {
  getActivePanelId(): string | null;
  setActivePanel(panelId: string | null): void;
};

export function setUtilitySectionActive(
  button: Pick<UtilityToggleTarget, "setAttribute" | "classList">,
  panel: UtilityPanelTarget,
  active: boolean,
): void {
  button.setAttribute("aria-expanded", active ? "true" : "false");
  button.classList.toggle("is-active", active);
  panel.hidden = !active;
  panel.classList.toggle("is-active", active);
}

export function createUtilitySectionController(
  entries: UtilitySectionEntry[],
  onToggle?: (panelId: string | null) => void,
): UtilitySectionController {
  let activePanelId: string | null = null;

  const sync = (): void => {
    for (const entry of entries) {
      setUtilitySectionActive(entry.button, entry.panel, entry.panelId === activePanelId);
    }
  };

  const setActivePanel = (panelId: string | null): void => {
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

export function setupUtilitySections(
  root: ParentNode = document,
  onToggle?: (panelId: string | null) => void,
): UtilitySectionController {
  const entries: UtilitySectionEntry[] = [];
  const buttons = root.querySelectorAll<HTMLButtonElement>("[data-utility-rail]");
  for (const button of buttons) {
    const panelId = button.getAttribute("data-utility-target");
    if (!panelId) {
      continue;
    }

    const panel = root.querySelector<HTMLElement>(`#${CSS.escape(panelId)}[data-utility-panel]`);
    if (!panel) {
      continue;
    }

    entries.push({ button, panel, panelId });
  }

  return createUtilitySectionController(entries, onToggle);
}
