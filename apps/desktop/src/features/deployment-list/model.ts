export type DeploymentListResultKind =
  | "success"
  | "stale"
  | "in_progress"
  | "needs_action"
  | "failed"
  | "not_started";

export interface DeploymentListResult {
  /** `success` is reserved for a result backed by current, unexpired evidence. */
  kind: DeploymentListResultKind;
  label: string;
}

export interface DeploymentListItem {
  additionalAddressCount?: number;
  currentResult: DeploymentListResult;
  environmentName: string;
  id: string;
  lastVerifiedLabel: string;
  primaryAddress?: string;
  projectName: string;
}
