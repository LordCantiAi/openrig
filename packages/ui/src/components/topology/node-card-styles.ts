// Shared geometry/typography for native agent and external-service cards.
// Keep hybrid dimensions owned by hybrid-layout.ts, not by card content.
export const NODE_CARD = "group relative min-w-[200px] border hard-shadow transition-[background-color,border-color,box-shadow] duration-300";
export const HYBRID_NODE_CARD = "group relative h-full w-full select-none border bg-surface-lowest/40 backdrop-blur-[8px] hard-shadow transition-[background-color,border-color,box-shadow] duration-300";
export const NODE_BODY = "space-y-1 px-2 py-1.5";
export const NODE_IDENTITY = "truncate font-mono text-[8px] leading-tight text-on-surface-variant";
export const NODE_HEADER = "px-3 py-1 font-mono text-[10px] flex justify-between items-center";
export const HYBRID_NODE_HEADER = "flex items-center justify-between gap-1 px-2 py-1 font-mono text-[8px]";
export const NODE_HEADER_SURFACE = "border-b border-on-surface bg-surface-high text-on-surface";
