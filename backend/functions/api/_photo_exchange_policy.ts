export type PhotoExchangeStage =
  | "ask_him_first"
  | "ready"
  | "already_shared"
  | "rule_disabled";

export interface PhotoExchangeGate {
  canSend: boolean;
  stage: PhotoExchangeStage;
  reason: string;
}

/**
 * 没看过他的照片时，只让他先发；他刚发来照片的这一轮也不发；
 * 已经看过他的照片后，下一轮再明确要才发；已经给他看过照片后，不再追着他要。
 */
export function resolvePhotoExchangeGate({
  hisPhotoSeenBeforeThisTurn = false,
  hisPhotoInCurrentTurn = false,
  herPhotoSeenBeforeThisTurn = false,
  ruleEnabled = true,
}: {
  hisPhotoSeenBeforeThisTurn?: boolean;
  hisPhotoInCurrentTurn?: boolean;
  herPhotoSeenBeforeThisTurn?: boolean;
  ruleEnabled?: boolean;
} = {}): PhotoExchangeGate {
  if (!ruleEnabled) {
    return { canSend: true, stage: "rule_disabled", reason: "photo_exchange_rule_disabled" };
  }
  if (herPhotoSeenBeforeThisTurn) {
    return { canSend: true, stage: "already_shared", reason: "her_photo_already_shared" };
  }
  // 他已经发过照片，或者这一轮刚发来，只要他明确要，就可以发；不再故意拖一轮。
  if (hisPhotoInCurrentTurn || hisPhotoSeenBeforeThisTurn) {
    return { canSend: true, stage: "ready", reason: "his_photo_seen" };
  }
  return { canSend: false, stage: "ask_him_first", reason: "his_photo_not_seen" };
}
