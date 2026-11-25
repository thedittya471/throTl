export interface TargetElementLike {
  tagName?: string;
  getAttribute?: (attr: string) => string | null;
  isContentEditable?: boolean;
  closest?: (selector: string) => any;
}

export function shouldIgnoreGlobalKey(target: TargetElementLike | null): boolean {
  if (!target) return false;
  return Boolean(
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

export function shouldIgnoreGlobalSpace(target: TargetElementLike | null): boolean {
  if (!target) return false;
  if (shouldIgnoreGlobalKey(target)) return true;
  if (
    target.tagName === "BUTTON" ||
    (target.closest && target.closest("button")) ||
    (target.getAttribute && target.getAttribute("role") === "button")
  ) {
    return true;
  }
  return false;
}
