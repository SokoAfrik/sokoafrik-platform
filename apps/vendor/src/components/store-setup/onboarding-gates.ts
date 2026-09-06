import type { SellerDTO } from "@mercurjs/types";

export type OnboardingGateKey =
  | "profile"
  | "phone"
  | "terms"
  | "bank"
  | "bank_verified"
  | "catalogue";

export type OnboardingStep = {
  key: OnboardingGateKey;
  labelKey: string;
  completed: boolean;
  path: string;
};

type OnboardingMetadata = {
  category?: unknown;
  phone_verified_at?: unknown;
  terms_accepted_at?: unknown;
  terms_version?: unknown;
  current_terms_version?: unknown;
  bank_verified_at?: unknown;
  publishable_products?: unknown;
  minimum_publishable_products?: unknown;
};

function onboardingMetadata(seller: SellerDTO): OnboardingMetadata {
  const value = seller.metadata?.soko_onboarding;

  return value && typeof value === "object" && !Array.isArray(value)
    ? value as OnboardingMetadata
    : {};
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getOnboardingSteps(seller: SellerDTO): OnboardingStep[] {
  const metadata = onboardingMetadata(seller);
  const publishableProducts = finiteNumber(metadata.publishable_products, 0);
  const minimumProducts = finiteNumber(metadata.minimum_publishable_products, 3);
  const hasCurrentTerms = Boolean(metadata.terms_accepted_at)
    && typeof metadata.terms_version === "string"
    && metadata.terms_version === metadata.current_terms_version;
  const hasBankAccount = Boolean(
    seller.payment_details?.account_number || seller.payment_details?.iban,
  );

  return [
    {
      key: "profile",
      labelKey: "onboarding.gates.profile",
      completed: Boolean(seller.name && metadata.category && seller.address?.city),
      path: "/settings/store/edit",
    },
    {
      key: "phone",
      labelKey: "onboarding.gates.phone",
      completed: Boolean(metadata.phone_verified_at),
      path: "/settings/store/edit",
    },
    {
      key: "terms",
      labelKey: "onboarding.gates.terms",
      completed: hasCurrentTerms,
      path: "/settings/store/edit",
    },
    {
      key: "bank",
      labelKey: "onboarding.gates.bank",
      completed: hasBankAccount,
      path: "/settings/store/payment-details",
    },
    {
      key: "bank_verified",
      labelKey: "onboarding.gates.bankVerified",
      completed: Boolean(metadata.bank_verified_at),
      path: "/settings/store/payment-details",
    },
    {
      key: "catalogue",
      labelKey: "onboarding.gates.catalogue",
      completed: publishableProducts >= minimumProducts,
      path: "/products",
    },
  ];
}
