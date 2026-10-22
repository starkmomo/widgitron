import { invoke } from "@tauri-apps/api/core";
import type { TauriCommand, TauriCommandArgs, TauriInvokeResult } from "../types/tauri";

type CommandsWithoutArgs = {
  [C in TauriCommand]: undefined extends TauriCommandArgs[C] ? C : never;
}[TauriCommand];

type CommandsWithArgs = {
  [C in TauriCommand]: Exclude<TauriCommandArgs[C], undefined> extends never ? never : C;
}[TauriCommand];

export function tauriInvoke<C extends CommandsWithoutArgs>(
  command: C
): Promise<TauriInvokeResult<C>>;
export function tauriInvoke<C extends CommandsWithArgs>(
  command: C,
  args: TauriCommandArgs[C]
): Promise<TauriInvokeResult<C>>;
export function tauriInvoke<C extends TauriCommand>(
  command: C,
  args?: TauriCommandArgs[C]
): Promise<TauriInvokeResult<C>> {
  if (args === undefined) {
    return invoke(command);
  }
  return invoke(command, args);
}
