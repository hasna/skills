// Side-effect entry: imported first by each launcher-started entry point so the
// caller's directory is restored before any other module evaluates.
import { restoreLaunchCwd } from "./launch-cwd.js";

restoreLaunchCwd();
