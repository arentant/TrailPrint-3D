import type { Component } from "vue";
import type { ModelFlowId } from "@shared/types/export";
import MountainTrailWorkspace from "@/features/mountain-trail/MountainTrailWorkspace.vue";

/** Each model flow owns its inputs, configuration panels and preview. */
export const modelWorkspaces: Record<ModelFlowId, Component> = {
  "mountain-trail": MountainTrailWorkspace,
};
