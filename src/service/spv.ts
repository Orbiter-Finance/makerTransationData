import { Context } from "./../../context";
export class SPV {
  constructor(public readonly ctx: Context) {}
  public checkUncollectedTransaction() {
    return true;
  }
}
