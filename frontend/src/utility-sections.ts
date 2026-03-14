type UtilityToggleTarget = {
  addEventListener(type: "click", listener: () => void): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
};

type UtilityPanelTarget = {
  hidden: boolean;
  classList: {
    toggle(token: string, force?: boolean): void;
  };
};

export function isUtilitySectionExpanded(button: Pick<UtilityToggleTarget, "getAttribute">): boolean {
  return button.getAttribute("aria-expanded") === "true";
}

export function setUtilitySectionExpanded(
  button: Pick<UtilityToggleTarget, "setAttribute">,
  panel: UtilityPanelTarget,
  expanded: boolean,
): void {
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  panel.hidden = !expanded;
  panel.classList.toggle("is-expanded", expanded);
}

export function bindUtilitySectionToggle(
  button: UtilityToggleTarget,
  panel: UtilityPanelTarget,
): void {
  setUtilitySectionExpanded(button, panel, isUtilitySectionExpanded(button));
  button.addEventListener("click", () => {
    setUtilitySectionExpanded(button, panel, !isUtilitySectionExpanded(button));
  });
}

export function setupUtilitySections(root: ParentNode = document): void {
  const buttons = root.querySelectorAll<HTMLButtonElement>("[data-utility-toggle]");
  for (const button of buttons) {
    const panelId = button.getAttribute("aria-controls");
    if (!panelId) {
      continue;
    }

    const panel = root.querySelector<HTMLElement>(`#${CSS.escape(panelId)}[data-utility-panel]`);
    if (!panel) {
      continue;
    }

    bindUtilitySectionToggle(button, panel);
  }
}
