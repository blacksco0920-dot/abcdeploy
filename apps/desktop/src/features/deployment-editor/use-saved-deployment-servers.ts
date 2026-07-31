import { useEffect, useRef, useState } from "react";
import type { ServerResource } from "../../types";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import { serverOption } from "./server-deployment-setup";

export function useSavedDeploymentServers(services: DeploymentEditorServices) {
  const [servers, setServers] = useState(
    () => [] as ReturnType<typeof serverOption>[],
  );
  const resources = useRef(new Map<string, ServerResource>());
  useEffect(() => {
    let active = true;
    void services
      .listSavedServers()
      .then((saved) => {
        if (!active) return;
        resources.current = new Map(saved.map((server) => [server.id, server]));
        setServers(saved.map(serverOption));
      })
      .catch(() => active && setServers([]));
    return () => {
      active = false;
    };
  }, [services]);
  return { resources, servers, setServers };
}
