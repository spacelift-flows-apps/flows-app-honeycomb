// Events
import { createEventV1 } from "./events/CreateEventV1";

// Queries
import { runQueryV1 } from "./queries/RunQueryV1";

// Triggers
import { subscribeToTriggerV1 } from "./triggers/SubscribeToTriggerV1";

export { createEventV1, runQueryV1, subscribeToTriggerV1 };

export const blocks = {
  // Events
  createEventV1,

  // Queries
  runQueryV1,

  // Triggers
  subscribeToTriggerV1,
} as const;
