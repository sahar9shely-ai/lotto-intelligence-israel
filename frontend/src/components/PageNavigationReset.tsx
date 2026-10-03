import { useLayoutEffect, useRef } from "react";
import type { NavigationType } from "react-router-dom";

/** Mount inside the pathname-keyed transition, when the incoming page is ready. */
export function PageNavigationReset({ navigationType }: { navigationType: NavigationType }) {
  const initialNavigationType = useRef(navigationType);

  useLayoutEffect(() => {
    // Back/forward keeps browser restoration; page-specific target effects run later.
    if (initialNavigationType.current === "POP") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  return null;
}
