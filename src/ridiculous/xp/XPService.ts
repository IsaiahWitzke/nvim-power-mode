import * as vscode from "vscode";

export class XPService {
  private readonly context: vscode.ExtensionContext;
  private baseXp: number;
  xp: number;
  level: number;
  xpNextAbs: number;

  constructor(context: vscode.ExtensionContext, baseXp: number) {
    this.context = context;
    this.baseXp = baseXp;
    this.xp = context.globalState.get<number>("xp", 0);
    this.level = context.globalState.get<number>("level", 1);
    // Initial absolute target as per original: 2 * BASE_XP
    const storedNext = context.globalState.get<number>("xpNextAbs");
    this.xpNextAbs = storedNext ?? 2 * this.baseXp;
    // Ensure monotonic if base changed
    if (this.xpNextAbs < this.xp) {
      this.xpNextAbs = this.xp + Math.round((this.baseXp * this.level) / 10) * 10;
    }
  }

  get progress(): { current: number; max: number } {
    const max = this.xpNextAbs - this.xpStartOfLevelInternal();
    return { current: this.xp - this.xpStartOfLevelInternal(), max };
  }

  private xpStartOfLevelInternal(): number {
    // We store absolute xp; to derive start-of-level, deduce from xpNextAbs and base formula.
    // Simplify: track last level-up xp in globalState too; fallback to 0 for level 1.
    return this.context.globalState.get<number>("xpLevelStart", 0);
  }

  get xpStartOfLevel(): number {
    return this.xpStartOfLevelInternal();
  }

  private setXpStartOfLevel(v: number) {
    void this.context.globalState.update("xpLevelStart", v);
  }

  addXp(n: number): boolean {
    this.xp += n;
    let leveledUp = false;
    if (this.xp >= this.xpNextAbs) {
      this.level += 1;
      this.setXpStartOfLevel(this.xp);
      // xpNext = xp + round(BASE_XP * level / 10.0) * 10
      this.xpNextAbs = this.xp + Math.round((this.baseXp * this.level) / 10) * 10;
      leveledUp = true;
    }
    this.persist();
    return leveledUp;
  }

  reset(): void {
    this.level = 1;
    this.xp = 0;
    this.setXpStartOfLevel(0);
    this.xpNextAbs = 2 * this.baseXp;
    this.persist();
  }

  setBaseXp(base: number) {
    this.baseXp = base;
    // Recompute next target relative to current xp and level
    if (this.level <= 1 && this.xp === 0) {
      this.xpNextAbs = 2 * this.baseXp;
    } else if (this.xp >= this.xpNextAbs) {
      this.xpNextAbs = this.xp + Math.round((this.baseXp * this.level) / 10) * 10;
    }
    this.persist();
  }

  private persist() {
    void this.context.globalState.update("xp", this.xp);
    void this.context.globalState.update("level", this.level);
    void this.context.globalState.update("xpNextAbs", this.xpNextAbs);
  }
}