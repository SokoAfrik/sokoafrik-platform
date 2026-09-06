import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Container, Text, clx } from "@medusajs/ui";
import { TriangleDownMini } from "@medusajs/icons";
import { Collapsible as RadixCollapsible } from "radix-ui";

import { SellerDTO } from "@mercurjs/types";
import { OnboardingChecklist } from "./onboarding-checklist";
import { getOnboardingSteps } from "./onboarding-gates";

const StoreSetup = ({ seller }: { seller: SellerDTO }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  const steps = useMemo(
    () => getOnboardingSteps(seller).map((step) => ({
      ...step,
      label: t(step.labelKey),
    })),
    [seller, t],
  );

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const progressPercent = (completedCount / totalCount) * 100;

  if (completedCount === totalCount) {
    return null;
  }

  return (
    <RadixCollapsible.Root open={open} onOpenChange={setOpen}>
      <Container className="overflow-hidden p-0">
        <div
          className="h-1 bg-ui-tag-green-icon transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
        <div className="p-6">
          <RadixCollapsible.Trigger asChild>
            <button className="flex w-full items-center justify-between">
              <Text size="large" weight="plus" leading="compact">
                {t("onboarding.title")}
              </Text>
              <TriangleDownMini
                className={clx(
                  "text-ui-fg-muted transition-transform duration-200",
                  !open && "-rotate-90",
                )}
              />
            </button>
          </RadixCollapsible.Trigger>

          <RadixCollapsible.Content>
            <div className="mt-4">
              <OnboardingChecklist
                steps={steps}
                completeLabel={t("onboarding.status.complete")}
                incompleteLabel={t("onboarding.status.incomplete")}
                nextActionLabel={t("onboarding.status.nextAction")}
                onSelect={(step) => navigate(step.path)}
              />
            </div>
          </RadixCollapsible.Content>
        </div>
      </Container>
    </RadixCollapsible.Root>
  );
};

export default StoreSetup;
