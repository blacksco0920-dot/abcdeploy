import { invoke } from "@tauri-apps/api/core";

invoke(commandName);
invoke(`alpha-${suffix}`);
invoke(resolveCommand());
