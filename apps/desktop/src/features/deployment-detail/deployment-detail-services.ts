import {
  listDeploymentPathRuns,
  listDeploymentPaths,
  redeployDeploymentPathVersion,
} from "../../api";
import type { DeploymentPath, DeploymentRun } from "../../types";
import {
  defaultDeploymentEditorServices,
  type DeploymentEditorServices,
} from "../deployment-editor/deployment-editor-services";

export interface DeploymentDetailServices {
  listPaths: (projectPath: string) => Promise<DeploymentPath[]>;
  listRuns: (pathId: string, projectPath: string) => Promise<DeploymentRun[]>;
  restoreVersion: (
    pathId: string,
    runId: string,
    projectPath: string,
  ) => Promise<DeploymentRun>;
  openAddress: (address: string) => Promise<void>;
  setupServices: DeploymentEditorServices;
}

export const defaultDeploymentDetailServices: DeploymentDetailServices = {
  listPaths: listDeploymentPaths,
  listRuns: listDeploymentPathRuns,
  restoreVersion: redeployDeploymentPathVersion,
  openAddress: defaultDeploymentEditorServices.openAddress,
  setupServices: defaultDeploymentEditorServices,
};
