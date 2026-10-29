import { StreamScreen } from "../../screens/stream/streamScreen.js";

// New TV Sources screen (beta): reuses the StreamScreen data logic and will override only
// the view. For now it is the current screen, so the router facade can ship on its own.
export const NewSourcesScreen = { ...StreamScreen };
