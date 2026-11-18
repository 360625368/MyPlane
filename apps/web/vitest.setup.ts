import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Dialog/form sizing has no layout to observe in jsdom.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
afterEach(cleanup);
