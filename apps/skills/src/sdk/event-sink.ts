/**
 * Default lifecycle event sink: @hasna/events' EventsClient over the
 * package-owned JSON store.
 *
 * Kept in its own module so the events service can import it lazily - an
 * embedder that injects its own sink (a SaaS bus, a test recorder) never
 * touches the local store.
 */
import { EventsClient, JsonEventsStore, getEventsDataDir } from "@hasna/events";
import type { RunEventSink } from "./events.js";

let cachedClient: EventsClient | undefined;

export function defaultEventsSink(): RunEventSink {
  return async (event) => {
    if (!cachedClient) {
      const store = new JsonEventsStore(getEventsDataDir());
      await store.init();
      cachedClient = new EventsClient({ store });
    }
    await cachedClient.emit(event);
  };
}
