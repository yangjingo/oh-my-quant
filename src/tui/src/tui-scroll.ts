import { activeConversationStatusRows, conversationMaxScrollUp, overviewMaxScrollTop } from "./render.ts";
import type { Layout, PanelSection, UIMessage } from "./types.ts";
import type { ScrollRegion } from "./input.ts";

export interface ScrollState {
  convScrollUp: number;
  overviewScrollTop: number;
}

function conversationReservedRows(activity: string, messages: UIMessage[], innerH: number): number {
  return activeConversationStatusRows(activity, messages, innerH);
}

export function clampScrollState(
  layoutState: Layout,
  messages: UIMessage[],
  panel: PanelSection[],
  activity: string,
  current: ScrollState,
): ScrollState {
  const convInnerH = layoutState.mainPane.h - 2;
  const convInnerW = layoutState.mainPane.w - 4;
  const convScrollUp = Math.min(
    current.convScrollUp,
    conversationMaxScrollUp(messages, convInnerW, convInnerH, conversationReservedRows(activity, messages, convInnerH)),
  );
  if (!layoutState.showPanel) {
    return { convScrollUp, overviewScrollTop: 0 };
  }
  const ovInnerH = layoutState.portfolio.h - 2;
  const overviewScrollTop = Math.min(current.overviewScrollTop, overviewMaxScrollTop(panel, ovInnerH));
  return { convScrollUp, overviewScrollTop };
}

export function applyScrollDelta(
  layoutState: Layout,
  region: ScrollRegion,
  delta: number,
  messages: UIMessage[],
  panel: PanelSection[],
  activity: string,
  current: ScrollState,
): ScrollState {
  if (region === "conversation") {
    const convInnerH = layoutState.mainPane.h - 2;
    const max = conversationMaxScrollUp(
      messages,
      layoutState.mainPane.w - 4,
      convInnerH,
      conversationReservedRows(activity, messages, convInnerH),
    );
    return {
      ...current,
      convScrollUp: Math.min(max, Math.max(0, current.convScrollUp + delta)),
    };
  }
  if (region === "overview" && layoutState.showPanel) {
    const max = overviewMaxScrollTop(panel, layoutState.portfolio.h - 2);
    return {
      ...current,
      overviewScrollTop: Math.min(max, Math.max(0, current.overviewScrollTop + delta)),
    };
  }
  return current;
}

export function wheelStep(layoutState: Layout, region: ScrollRegion): number {
  const h = region === "overview" ? layoutState.portfolio.h : layoutState.mainPane.h;
  return Math.max(1, Math.floor((h - 3) / 4));
}

export function scrollRegionDelta(layoutState: Layout, region: ScrollRegion, up: boolean, page: boolean): number {
  const step = page
    ? Math.max(1, (region === "overview" ? layoutState.portfolio.h : layoutState.mainPane.h) - 3)
    : 1;
  if (region === "conversation") return up ? step : -step;
  if (region === "overview") return up ? -step : step;
  return 0;
}
