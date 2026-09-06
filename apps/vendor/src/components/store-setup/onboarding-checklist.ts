import { createElement } from "react";

import type { OnboardingStep } from "./onboarding-gates";

type OnboardingChecklistProps = {
  steps: Array<OnboardingStep & { label: string }>;
  completeLabel: string;
  incompleteLabel: string;
  onSelect?: (step: OnboardingStep) => void;
};

export function OnboardingChecklist({
  steps,
  completeLabel,
  incompleteLabel,
  onSelect,
}: OnboardingChecklistProps) {
  return createElement(
    "ol",
    { className: "flex flex-col gap-y-3" },
    steps.map((step) => {
      const status = step.completed ? "complete" : "incomplete";
      const statusLabel = step.completed ? completeLabel : incompleteLabel;

      return createElement(
        "li",
        { key: step.key, "data-gate": step.key, "data-status": status },
        createElement(
          "button",
          {
            type: "button",
            className: "flex w-full items-center gap-x-3 text-left",
            disabled: step.completed,
            onClick: () => onSelect?.(step),
            "aria-label": `${step.label}: ${statusLabel}`,
          },
          createElement(
            "span",
            {
              "aria-hidden": true,
              className: step.completed
                ? "text-ui-tag-green-icon"
                : "text-ui-fg-muted",
            },
            step.completed ? "✓" : "○",
          ),
          createElement("span", null, step.label),
          createElement(
            "span",
            { className: "ml-auto text-ui-fg-muted" },
            statusLabel,
          ),
        ),
      );
    }),
  );
}
